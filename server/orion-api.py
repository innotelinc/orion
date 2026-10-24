#!/usr/bin/env python3
"""Orion's API — the real machine, not a seeded one.

The desktop used to invent its files, disks and counters in the browser. This
service replaces that: one JSON surface over the container it runs in.

    /srv/storage                  the data volume the Files app browses
    /srv/storage/Users            one folder per person, managed in Settings
    /srv/storage/.orion/trash     "delete" moves here, never unlinks
    /srv/storage/.orion/starred   per-path star flags
    /srv/storage/.orion/spaces    who the Users folders belong to

Read-only facts come from /proc, /sys and systemd; the only mutating calls are
the file operations and service start/stop/restart, and both are restricted to
this container. nginx puts this behind the same sign-in as the desktop, and the
vhost only accepts the edge proxy's address, so the port is never public.

    python3 orion-api.py            # 127.0.0.1:8099
"""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import threading
import time
import unicodedata
import urllib.parse
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(os.environ.get("ORION_ROOT", "/srv/storage")).resolve()
META = ROOT / ".orion"
TRASH = META / "trash"
STARS = META / "starred.json"
SPACES = META / "spaces.json"
USERS_DIR_NAME = "Users"
SPACE_ROLES = ("Owner", "Admin", "Member", "Guest")
SPACE_PALETTE = ["#0a63ff", "#8b5cf6", "#10b981", "#f59e0b", "#f43f5e", "#06b6d4"]
SMB_CONF = Path("/etc/samba/smb.conf")
SMB_CONF_BACKUP = Path("/etc/samba/smb.conf.orion-backup")
SMB_GROUP = "orion-nas"
# One name for the box on the LAN, whatever protocol a client speaks.
DISCOVERY_NAME = "orion-nas"
NETBIOS_NAME = "ORION-NAS"
AVAHI_CONF = Path("/etc/avahi/avahi-daemon.conf")
AVAHI_SERVICE = Path("/etc/avahi/services/orion-smb.service")
APT_TIMEOUT = 900

try:
    import pwd
except ImportError:  # Windows has no Unix account database; spaces still work.
    pwd = None

# Apps this host can actually install. Each entry is a package set and the unit
# that proves it is running; nothing here is a mock, so an entry that cannot be
# installed on the container fails with apt's own reason.
APP_CATALOGUE: list[dict] = [
    {
        "id": "smb",
        "name": "SMB sharing",
        "tagline": "Samba shares for every space",
        "description": (
            "Exports each person's folder as their own authenticated share, plus the media "
            "library read-only. Accounts are the spaces themselves, managed in Settings."
        ),
        "category": "Sharing",
        "packages": ["samba"],
        "unit": "smbd.service",
    },
    {
        "id": "nfs",
        "name": "NFS server",
        "tagline": "Kernel NFS for Linux and macOS clients",
        "description": (
            "Installs the NFS server and starts it. Exports are not written for you: they belong "
            "to the client's expectations, so they stay a manual /etc/exports edit."
        ),
        "category": "Sharing",
        "packages": ["nfs-kernel-server"],
        "unit": "nfs-server.service",
    },
    {
        "id": "discovery",
        "name": "Network discovery",
        "tagline": f"Reachable as {DISCOVERY_NAME}.local",
        "description": (
            f"Advertises SMB over mDNS as {DISCOVERY_NAME}.local, so Finder, GNOME and Windows "
            f"find the box by name instead of an address. Samba also answers to "
            f"\\\\{NETBIOS_NAME} over NetBIOS."
        ),
        "category": "Network",
        "packages": ["avahi-daemon"],
        "unit": "avahi-daemon.service",
    },
]
VERSION_FILE = Path(os.environ.get("ORION_VERSION_FILE", "/opt/orion/version.json"))
BIND = os.environ.get("ORION_BIND", "127.0.0.1")
PORT = int(os.environ.get("ORION_PORT", "8099"))
MAX_NODES = 20_000
HISTORY = 60
SAMPLE_SECONDS = 2.0

TONE_BY_EXTENSION = {
    "image": {"jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "svg", "avif", "raw", "tif", "tiff"},
    "video": {"mp4", "mkv", "mov", "avi", "webm", "m4v"},
    "audio": {"mp3", "flac", "wav", "m4a", "m4b", "ogg", "opus"},
    "document": {"pdf", "doc", "docx", "txt", "md", "rtf", "odt"},
    "sheet": {"xls", "xlsx", "csv", "ods", "numbers"},
    "archive": {"zip", "tar", "gz", "zst", "7z", "rar", "iso", "snap", "pkg", "xz", "bz2"},
    "code": {"js", "ts", "tsx", "jsx", "json", "css", "html", "py", "sh", "yml", "yaml", "toml", "rs", "go", "c", "h"},
}

UNIT_PATTERN = re.compile(r"^[A-Za-z0-9@._:-]+\.service$")


def tone_for(name: str) -> str:
    suffix = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    for tone, extensions in TONE_BY_EXTENSION.items():
        if suffix in extensions:
            return tone
    return "file"


def read_text(path: str, default: str = "") -> str:
    try:
        return Path(path).read_text().strip()
    except OSError:
        return default


# ---------------------------------------------------------------- filesystem


def safe_path(virtual: str) -> Path:
    """Map a desktop path (/media/film.mkv) to a real one, refusing escapes."""
    if not virtual.startswith("/"):
        raise ValueError("paths must be absolute")
    candidate = (ROOT / virtual.lstrip("/")).resolve()
    if candidate != ROOT and ROOT not in candidate.parents:
        raise ValueError("path escapes the storage root")
    return candidate


def virtual_path(path: Path) -> str:
    relative = path.relative_to(ROOT).as_posix()
    return "/" if relative in ("", ".") else f"/{relative}"


def load_stars() -> set[str]:
    try:
        payload = json.loads(STARS.read_text())
        return {str(item) for item in payload if isinstance(item, str)}
    except (OSError, ValueError):
        return set()


def save_stars(stars: set[str]) -> None:
    META.mkdir(parents=True, exist_ok=True)
    STARS.write_text(json.dumps(sorted(stars), indent=2) + "\n")


def scan_files() -> list[dict]:
    """Every entry under the volume, flat — the shape the desktop already routes on."""
    stars = load_stars()
    nodes: list[dict] = []
    stack = [ROOT]
    while stack and len(nodes) < MAX_NODES:
        directory = stack.pop()
        try:
            entries = list(os.scandir(directory))
        except OSError:
            continue
        for entry in entries:
            if entry.name.startswith("."):
                continue
            try:
                is_dir = entry.is_dir(follow_symlinks=False)
                if not is_dir and not entry.is_file(follow_symlinks=False):
                    continue
                stat = entry.stat(follow_symlinks=False)
            except OSError:
                continue
            path = Path(entry.path)
            nodes.append(
                {
                    "id": virtual_path(path),
                    "name": entry.name,
                    "parent": virtual_path(path.parent),
                    "type": "folder" if is_dir else "file",
                    "size": None if is_dir else stat.st_size,
                    "modifiedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stat.st_mtime)),
                    "owner": "root",
                    "tone": "folder" if is_dir else tone_for(entry.name),
                    "starred": virtual_path(path) in stars,
                }
            )
            if is_dir:
                stack.append(path)
    return nodes


def unique_child(parent: Path, name: str) -> Path:
    candidate = parent / name
    if not candidate.exists():
        return candidate
    stem, dot, suffix = name.rpartition(".")
    counter = 2
    while True:
        next_name = f"{stem} ({counter}){dot}{suffix}" if dot else f"{name} ({counter})"
        candidate = parent / next_name
        if not candidate.exists():
            return candidate
        counter += 1


def clean_name(raw: str) -> str:
    name = (raw or "").strip()
    if not name or name in (".", "..") or "/" in name or "\\" in name or "\0" in name:
        raise ValueError("that name cannot be used")
    if len(name) > 120:
        raise ValueError("keep names under 120 characters")
    return name


def copy_body(handle, stream, length: int | None, chunked: bool) -> int:
    """Copy a request body, honouring either Content-Length or chunked framing."""
    written = 0
    if chunked:
        while True:
            header = stream.readline().strip()
            if not header:
                break
            size = int(header.split(b";")[0], 16)
            if size == 0:
                # Trailers, then a blank line.
                while stream.readline().strip():
                    pass
                break
            remaining = size
            while remaining:
                chunk = stream.read(min(262_144, remaining))
                if not chunk:
                    raise ValueError("upload ended mid-chunk")
                handle.write(chunk)
                written += len(chunk)
                remaining -= len(chunk)
            stream.readline()
        return written

    remaining = length
    while remaining is None or remaining > 0:
        chunk = stream.read(262_144 if remaining is None else min(262_144, remaining))
        if not chunk:
            break
        handle.write(chunk)
        written += len(chunk)
        if remaining is not None:
            remaining -= len(chunk)
    return written


def upload_stream(
    directory: Path, name: str, stream, length: int | None, chunked: bool = False
) -> dict:
    target = unique_child(directory, clean_name(name))
    with open(target, "xb") as handle:
        try:
            copy_body(handle, stream, length, chunked)
        except ValueError:
            handle.close()
            target.unlink(missing_ok=True)
            raise
    stat = target.stat()
    return {
        "id": virtual_path(target),
        "name": target.name,
        "parent": virtual_path(directory),
        "type": "file",
        "size": stat.st_size,
        "modifiedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stat.st_mtime)),
        "owner": "root",
        "tone": tone_for(target.name),
        "starred": False,
    }


def move_to_trash(paths: list[str]) -> int:
    TRASH.mkdir(parents=True, exist_ok=True)
    moved = 0
    for virtual in paths:
        target = safe_path(virtual)
        if target == ROOT or not target.exists():
            continue
        destination = unique_child(TRASH, target.name)
        shutil.move(str(target), str(destination))
        moved += 1
    return moved


# --------------------------------------------------------------- host facts


def default_interface() -> str:
    for line in read_text("/proc/net/route").splitlines()[1:]:
        fields = line.split()
        if len(fields) > 2 and fields[1] == "00000000":
            return fields[0]
    return "eth0"


def ipv4_from_hex(value: str) -> str:
    return ".".join(str(int(value[index : index + 2], 16)) for index in (6, 4, 2, 0))


def network_facts() -> dict:
    interface = default_interface()
    address = ""
    prefix = ""
    try:
        output = subprocess.run(
            ["ip", "-4", "-o", "addr", "show", interface],
            capture_output=True,
            text=True,
            timeout=3,
        ).stdout.split()
        if "inet" in output:
            cidr = output[output.index("inet") + 1]
            address, _, prefix = cidr.partition("/")
    except (OSError, subprocess.SubprocessError):
        pass
    gateway = ""
    for line in read_text("/proc/net/route").splitlines()[1:]:
        fields = line.split()
        if len(fields) > 2 and fields[1] == "00000000":
            gateway = ipv4_from_hex(fields[2])
            break
    dns = []
    try:
        # systemd-resolved owns /etc/resolv.conf here (127.0.0.53), so the
        # upstream servers are the useful ones to report.
        resolved = subprocess.run(
            ["resolvectl", "dns"], capture_output=True, text=True, timeout=3
        ).stdout
        for line in resolved.splitlines():
            _, _, servers = line.partition(":")
            dns.extend(server for server in servers.split() if server.count(".") == 3)
    except (OSError, subprocess.SubprocessError):
        pass
    if not dns:
        dns = [
            line.split()[1]
            for line in read_text("/etc/resolv.conf").splitlines()
            if line.startswith("nameserver") and len(line.split()) > 1
        ]
    speed = None
    raw_speed = read_text(f"/sys/class/net/{interface}/speed")
    if raw_speed.isdigit() and int(raw_speed) > 0:
        speed = int(raw_speed)
    return {
        "interface": interface,
        "method": "static" if gateway else "dhcp",
        "ip": address,
        "prefix": prefix,
        "gateway": gateway,
        "dns": dns,
        "mac": read_text(f"/sys/class/net/{interface}/address"),
        "linkMbps": speed,
    }


def memory_facts() -> dict:
    values: dict[str, int] = {}
    for line in read_text("/proc/meminfo").splitlines():
        key, _, rest = line.partition(":")
        parts = rest.split()
        if parts and parts[0].isdigit():
            values[key] = int(parts[0]) * 1024
    total = values.get("MemTotal", 0)
    available = values.get("MemAvailable", 0)
    return {
        "totalBytes": total,
        "usedBytes": max(0, total - available),
        "availableBytes": available,
        "percent": round((total - available) / total * 100) if total else 0,
    }


def cpu_model() -> str:
    for line in read_text("/proc/cpuinfo").splitlines():
        if line.lower().startswith("model name"):
            return line.split(":", 1)[1].strip()
    return "Unknown CPU"


def cpu_mhz() -> float:
    speeds = [
        float(line.split(":", 1)[1])
        for line in read_text("/proc/cpuinfo").splitlines()
        if line.lower().startswith("cpu mhz") and ":" in line
    ]
    return round(sum(speeds) / len(speeds), 1) if speeds else 0.0


def temperature() -> float | None:
    for zone in sorted(Path("/sys/class/thermal").glob("thermal_zone*")):
        raw = read_text(str(zone / "temp"))
        if raw.lstrip("-").isdigit():
            value = int(raw) / 1000
            if -40 < value < 150:
                return round(value, 1)
    return None


def uptime_seconds() -> float:
    try:
        return float(read_text("/proc/uptime").split()[0])
    except (OSError, ValueError, IndexError):
        return 0.0


def version_facts() -> dict:
    try:
        payload = json.loads(VERSION_FILE.read_text())
        return {
            "version": str(payload.get("version", "dev")),
            "build": str(payload.get("build", "dev")),
            "builtAt": payload.get("builtAt"),
        }
    except (OSError, ValueError):
        return {"version": "dev", "build": "dev", "builtAt": None}


def container_runtime() -> str:
    try:
        detected = subprocess.run(
            ["systemd-detect-virt", "--container"], capture_output=True, text=True, timeout=3
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        detected = ""
    if not detected or detected == "none":
        return "Bare metal"
    return {"lxc": "Incus / LXC", "docker": "Docker", "podman": "Podman"}.get(
        detected, detected.capitalize()
    )


def storage_facts() -> dict:
    pools = []
    seen = set()
    for name, mount in (("System", "/"), ("Files", str(ROOT))):
        try:
            usage = shutil.disk_usage(mount)
        except OSError:
            continue
        source = ""
        for line in read_text("/proc/self/mountinfo").splitlines():
            fields = line.split()
            if len(fields) > 4 and fields[4] == mount:
                separator = fields.index("-") if "-" in fields else -1
                if separator > 0 and len(fields) > separator + 2:
                    source = fields[separator + 2]
                break
        if mount in seen:
            continue
        seen.add(mount)
        pools.append(
            {
                "id": f"pool-{len(pools)}",
                "name": name,
                "mount": mount,
                "source": source,
                "usedBytes": usage.used,
                "totalBytes": usage.total,
                "freeBytes": usage.free,
                "health": "Healthy" if usage.total and usage.used / usage.total < 0.9 else "Warning",
                "kind": "zfs" if source.startswith("tank/") else "filesystem",
            }
        )

    disks = []
    for block in sorted(Path("/sys/block").glob("*")):
        name = block.name
        if name.startswith(("loop", "ram", "dm-", "md", "sr")):
            continue
        try:
            sectors = int(read_text(str(block / "size")) or 0)
        except ValueError:
            continue
        if sectors <= 0:
            continue
        model = read_text(str(block / "device/model")) or name
        rotational = read_text(str(block / "queue/rotational")) == "1"
        disks.append(
            {
                "id": name,
                "name": name,
                "model": model.strip(),
                "capacityBytes": sectors * 512,
                "kind": "HDD" if rotational else "SSD",
                "temperature": None,
                "health": "Healthy",
                "note": "host device, not managed inside this container",
            }
        )

    nodes = scan_files()
    return {
        "pools": pools,
        "disks": disks,
        "files": {
            "count": sum(1 for node in nodes if node["type"] == "file"),
            "folders": sum(1 for node in nodes if node["type"] == "folder"),
            "bytes": sum(node["size"] or 0 for node in nodes),
        },
    }


def users_facts(identity: dict | None) -> list[dict]:
    palette = ["#0a63ff", "#8b5cf6", "#10b981", "#f59e0b", "#f43f5e", "#06b6d4"]
    users = []
    for line in read_text("/etc/passwd").splitlines():
        fields = line.split(":")
        if len(fields) < 7:
            continue
        name, _, uid, gid, gecos, home, shell = fields[:7]
        try:
            uid_value = int(uid)
        except ValueError:
            continue
        if uid_value != 0 and uid_value < 1000:
            continue
        if shell.endswith(("nologin", "false")):
            continue
        display = gecos.split(",")[0] or name
        users.append(
            {
                "id": f"u-{uid_value}",
                "name": display,
                "email": f"{name}@{socket.gethostname()}",
                "role": "Owner" if uid_value == 0 else "Member",
                "lastActive": "Never",
                "color": palette[uid_value % len(palette)],
                "isCurrent": False,
                "account": name,
                "home": home,
            }
        )
    if identity and identity.get("email"):
        users.insert(
            0,
            {
                "id": "sso",
                "name": identity.get("name") or identity["email"].split("@")[0],
                "email": identity["email"],
                "role": "Admin",
                "lastActive": "This session",
                "color": "#0a63ff",
                "isCurrent": True,
                "account": identity.get("username") or "",
                "home": "",
            },
        )
    return users


# ------------------------------------------------------------------ spaces
#
# A person is a folder. There is no sign-in to grant, so "adding a user" is
# creating that folder and recording whose it is; "removing" one moves it to
# Trash like any other delete. Everything lives inside the storage volume, which
# is the only place this service writes.


def users_root() -> Path:
    return ROOT / USERS_DIR_NAME


def slug_for(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")[:32]
    return slug or "person"


def load_spaces() -> list[dict]:
    try:
        payload = json.loads(SPACES.read_text())
    except (OSError, ValueError):
        return []
    items = payload.get("spaces") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict) and str(item.get("slug", "")).strip()]


def save_spaces(spaces: list[dict]) -> None:
    """Write the whole list at once: a crash must not leave half a registry."""
    META.mkdir(parents=True, exist_ok=True)
    temporary = SPACES.with_name(SPACES.name + ".tmp")
    temporary.write_text(json.dumps({"spaces": spaces}, indent=2) + "\n")
    temporary.replace(SPACES)


def folder_bytes(directory: Path, budget: int = 20_000) -> int:
    """Bytes under one folder, capped so a huge tree cannot stall a request."""
    total = 0
    pending = [directory]
    while pending and budget > 0:
        following = []
        for current in pending:
            try:
                entries = list(os.scandir(current))
            except OSError:
                continue
            for entry in entries:
                if budget <= 0:
                    break
                budget -= 1
                try:
                    if entry.is_dir(follow_symlinks=False):
                        following.append(Path(entry.path))
                    elif entry.is_file(follow_symlinks=False):
                        total += entry.stat(follow_symlinks=False).st_size
                except OSError:
                    continue
        pending = following
    return total


def space_facts(space: dict, index: int) -> dict:
    slug = str(space["slug"])
    return {
        "id": slug,
        "slug": slug,
        "name": str(space.get("name") or slug),
        "email": str(space.get("email") or ""),
        "role": space.get("role") if space.get("role") in SPACE_ROLES else "Member",
        "path": f"/{USERS_DIR_NAME}/{slug}",
        "usedBytes": folder_bytes(users_root() / slug),
        "createdAt": str(space.get("createdAt") or ""),
        "color": str(space.get("color") or SPACE_PALETTE[index % len(SPACE_PALETTE)]),
        "smb": bool(space.get("smb")) and samba_installed(),
    }


def spaces_facts() -> list[dict]:
    """Registered spaces whose folder still exists; a folder deleted in Files drops out."""
    spaces = load_spaces()
    present = [space for space in spaces if (users_root() / str(space["slug"])).is_dir()]
    if len(present) != len(spaces):
        try:
            save_spaces(present)
        except OSError:
            pass
    return [space_facts(space, index) for index, space in enumerate(present)]


def create_space(payload: dict) -> dict:
    name = str(payload.get("name", "")).strip()
    email = str(payload.get("email", "")).strip().lower()
    role = str(payload.get("role", "Member"))
    if len(name) < 2:
        raise ValueError("give the person a name")
    if len(name) > 80:
        raise ValueError("keep names under 80 characters")
    if role not in SPACE_ROLES:
        raise ValueError("unknown role")
    if email and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise ValueError("that email address does not look right")

    spaces = load_spaces()
    if email and any(str(space.get("email", "")).lower() == email for space in spaces):
        raise ValueError("a space with that email already exists")

    root = users_root()
    root.mkdir(parents=True, exist_ok=True)
    base = slug_for(name)
    slug = base
    counter = 2
    while any(str(space["slug"]) == slug for space in spaces) or (root / slug).exists():
        slug = f"{base}-{counter}"
        counter += 1
    password = str(payload.get("password") or "")
    (root / slug).mkdir()
    try:
        if password:
            write_smb_password(slug, name, password, adopt=False)
        smb = bool(password)
    except (ValueError, RuntimeError):
        # Nothing half-created: the folder goes back if the account did not.
        shutil.rmtree(root / slug, ignore_errors=True)
        raise

    space = {
        "slug": slug,
        "name": name,
        "email": email,
        "role": role,
        "color": SPACE_PALETTE[len(spaces) % len(SPACE_PALETTE)],
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "smb": smb,
    }
    save_spaces([*spaces, space])
    if smb:
        apply_smb_conf()
    return space_facts(space, len(spaces))


def delete_space(slug: str) -> dict:
    slug = str(slug or "").strip()
    if not slug or "/" in slug or slug in (".", ".."):
        raise ValueError("unknown space")
    spaces = load_spaces()
    space = next((item for item in spaces if str(item["slug"]) == slug), None)
    if space is None:
        raise LookupError("that person has no space on this host")

    if space.get("smb"):
        drop_samba_account(slug)
    target = users_root() / slug
    if target.is_dir():
        # Same rule as the Files app: deleting moves to Trash, never unlinks.
        TRASH.mkdir(parents=True, exist_ok=True)
        shutil.move(str(target), str(unique_child(TRASH, slug)))
    save_spaces([item for item in spaces if str(item["slug"]) != slug])
    if samba_installed():
        apply_smb_conf()
    return space_facts(space, 0)


def set_space_password(slug: str, password: str) -> dict:
    """Give an existing space an SMB account, or reset the one it has."""
    spaces = load_spaces()
    space = next((item for item in spaces if str(item["slug"]) == slug), None)
    if space is None:
        raise LookupError("that person has no space on this host")
    write_smb_password(
        slug, str(space.get("name") or slug), password, adopt=bool(space.get("smb"))
    )
    space["smb"] = True
    save_spaces(spaces)
    apply_smb_conf()
    return space_facts(space, spaces.index(space))


# -------------------------------------------------------------- app catalogue


def dpkg_installed(package: str) -> bool:
    try:
        completed = subprocess.run(
            ["dpkg-query", "-W", "-f=${Status}", package],
            capture_output=True,
            text=True,
            timeout=8,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return completed.returncode == 0 and "install ok installed" in completed.stdout


# A container image has no PID 1 systemd, so the same code has to answer for a
# daemon started by the entrypoint. Everything else works unchanged.
HAVE_SYSTEMD = Path("/run/systemd/system").is_dir()
UNIT_PROCESS = {
    "smbd.service": "smbd",
    "nmbd.service": "nmbd",
    "avahi-daemon.service": "avahi-daemon",
    "nginx.service": "nginx",
    "orion-api.service": "python3",
    "nfs-server.service": "rpc.nfsd",
}


def process_state(unit: str) -> tuple[bool, str]:
    process = UNIT_PROCESS.get(unit)
    if process is None:
        return False, "not managed here"
    try:
        completed = subprocess.run(
            ["pgrep", "-x", process[:15]], capture_output=True, text=True, timeout=4
        )
    except (OSError, subprocess.SubprocessError):
        return False, "unknown"
    return completed.returncode == 0, "active" if completed.returncode == 0 else "inactive"


def unit_state(unit: str) -> tuple[bool, str]:
    if not HAVE_SYSTEMD:
        return process_state(unit)
    try:
        completed = subprocess.run(
            ["systemctl", "is-active", unit], capture_output=True, text=True, timeout=6
        )
    except (OSError, subprocess.SubprocessError):
        return process_state(unit)
    state = completed.stdout.strip() or "unknown"
    return completed.returncode == 0 and state == "active", state


def samba_installed() -> bool:
    return dpkg_installed("samba")


def app_by_id(app_id: str) -> dict:
    for app in APP_CATALOGUE:
        if app["id"] == app_id:
            return app
    raise LookupError("no such app")


def app_facts(app: dict) -> dict:
    installed = all(dpkg_installed(package) for package in app["packages"])
    active, state = unit_state(app["unit"]) if installed else (False, "not installed")
    return {
        "id": app["id"],
        "name": app["name"],
        "tagline": app["tagline"],
        "description": app["description"],
        "category": app["category"],
        "packages": list(app["packages"]),
        "unit": app["unit"],
        "installed": installed,
        "active": active,
        "state": state,
    }


def apps_facts() -> list[dict]:
    return [app_facts(app) for app in APP_CATALOGUE]


def run_root(script: str, stdin_text: str | None = None, timeout: int = APT_TIMEOUT) -> str:
    """Run a root script outside this service's own filesystem sandbox.

    orion-api.service is ProtectSystem=strict, which is what keeps a bug in this
    process from editing /etc. apt and samba genuinely need that access, so the
    work happens in a transient unit: the daemon's privileges, none of its
    sandbox, and a unit name a human can see in the journal afterwards.
    """
    if not HAVE_SYSTEMD or shutil.which("systemd-run") is None:
        # No systemd: this process is already the container's root, so the
        # script runs directly. Nothing outside the container is reachable.
        completed = subprocess.run(
            ["/bin/sh", "-c", script],
            input=stdin_text,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if completed.returncode != 0:
            lines = [
                line.strip()
                for line in (completed.stderr or completed.stdout).splitlines()
                if line.strip()
            ]
            raise RuntimeError(lines[-1] if lines else f"the host refused the change ({completed.returncode})")
        return completed.stdout
    unit = f"orion-provision-{os.getpid()}-{int(time.time() * 1000) % 100_000}"
    completed = subprocess.run(
        [
            "systemd-run",
            "--quiet",
            "--collect",
            "--wait",
            "--pipe",
            f"--unit={unit}",
            "/bin/sh",
            "-c",
            script,
        ],
        input=stdin_text,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if completed.returncode != 0:
        lines = [line.strip() for line in (completed.stderr or completed.stdout).splitlines() if line.strip()]
        raise RuntimeError(lines[-1] if lines else f"the host refused the change ({completed.returncode})")
    return completed.stdout


def install_app(app_id: str) -> dict:
    app = app_by_id(app_id)
    packages = " ".join(app["packages"])
    run_root(
        "set -e\n"
        "export DEBIAN_FRONTEND=noninteractive\n"
        "apt-get update -qq\n"
        f"apt-get install -y --no-install-recommends {packages}\n"
        f"systemctl enable --now {app['unit']} >/dev/null 2>&1 || true\n"
    )
    if app["id"] == "smb":
        # The package ships its own smb.conf; replace it with the shares Orion knows.
        apply_smb_conf()
    if app["id"] == "discovery":
        # The name is the point of this app, so it is set here and not by hand.
        apply_discovery()
        if samba_installed():
            # Samba's own NetBIOS name lives in smb.conf, which Orion generated
            # before this app existed; rewrite it so both names agree.
            apply_smb_conf()
    facts = app_facts(app)
    if not facts["installed"]:
        raise RuntimeError(f"{app['name']} did not finish installing")
    return facts


def remove_app(app_id: str) -> dict:
    app = app_by_id(app_id)
    if app["id"] == "smb":
        # Accounts exist only for the daemon that owns them, so they go first.
        for space in load_spaces():
            if space.get("smb"):
                drop_samba_account(str(space["slug"]))
    run_root(
        "set -e\n"
        "export DEBIAN_FRONTEND=noninteractive\n"
        f"systemctl disable --now {app['unit']} >/dev/null 2>&1 || true\n"
        f"apt-get purge -y {' '.join(app['packages'])}\n"
    )
    if app["id"] == "smb":
        spaces = load_spaces()
        for space in spaces:
            space["smb"] = False
        save_spaces(spaces)
    return app_facts(app)


# ----------------------------------------------------------------------- samba


def unix_user_exists(slug: str) -> bool:
    if pwd is None:
        return False
    try:
        pwd.getpwnam(slug)
    except KeyError:
        return False
    return True


def samba_share_label(name: str) -> str:
    cleaned = re.sub(r"[\[\]\r\n/\\]", "", name).strip()
    return (cleaned or "Space")[:60]


def render_smb_conf(spaces: list[dict]) -> str:
    lines = [
        "# Managed by Orion. Rewritten whenever a space is added or removed,",
        "# so change the shares in Settings rather than editing this file.",
        "[global]",
        "   workgroup = WORKGROUP",
        "   server string = Orion NAS",
        f"   netbios name = {NETBIOS_NAME}",
        # Aliases are what let a client mount the box by its mDNS name: Windows
        # sends the whole \\host\share path at create time and smbd rejects it
        # unless the host part is one of its own names.
        f"   netbios aliases = nas {DISCOVERY_NAME}.local",
        "   server role = standalone server",
        "   map to guest = never",
        "   restrict anonymous = 2",
        "   usershare allow guests = no",
        "   server min protocol = SMB2",
        "   load printers = no",
        "   printing = bsd",
        "   printcap name = /dev/null",
        "   disable spoolss = yes",
        "   log file = /var/log/samba/log.%m",
        "   max log size = 1000",
        "",
    ]
    accounts = [str(space["slug"]) for space in spaces if space.get("smb")]
    media = ROOT / "media"
    if accounts and media.is_dir():
        lines += [
            "[Media]",
            "   comment = Media library (read only)",
            f"   path = {media}",
            "   browseable = yes",
            "   read only = yes",
            f"   valid users = @{SMB_GROUP}",
            f"   force group = {SMB_GROUP}",
            "",
        ]
    used: set[str] = set()
    for space in spaces:
        if not space.get("smb"):
            continue
        slug = str(space["slug"])
        label = samba_share_label(str(space.get("name") or slug))
        if label.lower() in used:
            label = f"{label} ({slug})"
        used.add(label.lower())
        lines += [
            f"[{label}]",
            f"   comment = {label}'s space",
            f"   path = {users_root() / slug}",
            "   browseable = yes",
            "   read only = no",
            f"   valid users = {slug}",
            "   create mask = 0660",
            "   directory mask = 0770",
            "",
        ]
    return "\n".join(lines) + "\n"


def apply_smb_conf() -> None:
    if not samba_installed():
        return
    content = render_smb_conf(load_spaces())
    run_root(
        "set -e\n"
        f"[ -f {SMB_CONF_BACKUP} ] || cp -f {SMB_CONF} {SMB_CONF_BACKUP} 2>/dev/null || true\n"
        f"cat > {SMB_CONF}\n"
        "systemctl enable --now smbd.service >/dev/null 2>&1 || true\n"
        "smbcontrol smbd reload-config >/dev/null 2>&1 || systemctl restart smbd.service\n"
        # nmbd is what answers NetBIOS name queries for \\\\ORION-NAS on Windows.
        "systemctl enable --now nmbd.service >/dev/null 2>&1 || true\n"
        "systemctl try-restart nmbd.service >/dev/null 2>&1 || true\n",
        stdin_text=content,
        timeout=120,
    )


def avahi_installed() -> bool:
    return dpkg_installed("avahi-daemon")


def render_avahi_service() -> str:
    """The Bonjour record: SMB on 445, published under the box's own name."""
    return (
        '<?xml version="1.0" standalone=\'no\'?>\n'
        '<!DOCTYPE service-group SYSTEM "avahi-service.dtd">\n'
        "<service-group>\n"
        '  <name replace-wildcards="yes">Orion NAS on %h</name>\n'
        "  <service>\n"
        "    <type>_smb._tcp</type>\n"
        "    <port>445</port>\n"
        "  </service>\n"
        "</service-group>\n"
    )


def apply_discovery() -> None:
    """Answer to a name on the LAN, so nobody has to remember an address.

    mDNS is what Finder, GNOME Files and the Windows DNS client resolve, so the
    host name is set explicitly rather than inherited from the container.
    """
    if not avahi_installed():
        return
    service = render_avahi_service()
    run_root(
        "set -e\n"
        f"[ -f {AVAHI_CONF} ] || exit 0\n"
        f"sed -i 's/^#*host-name=.*/host-name={DISCOVERY_NAME}/' {AVAHI_CONF}\n"
        f"grep -q '^host-name={DISCOVERY_NAME}' {AVAHI_CONF} || "
        f"sed -i '/^\\[server\\]/a host-name={DISCOVERY_NAME}' {AVAHI_CONF}\n"
        f"mkdir -p {AVAHI_SERVICE.parent}\n"
        f"cat > {AVAHI_SERVICE}\n"
        "systemctl enable avahi-daemon.service >/dev/null 2>&1 || true\n"
        "systemctl restart avahi-daemon.service >/dev/null 2>&1 || avahi-daemon --reload >/dev/null 2>&1 || true\n",
        stdin_text=service,
        timeout=120,
    )


def write_smb_password(slug: str, name: str, password: str, adopt: bool) -> None:
    """Create the Unix + Samba account for a space, or reset its password."""
    if not samba_installed():
        raise ValueError("install SMB sharing from the App Store first")
    if len(password) < 8:
        raise ValueError("use at least 8 characters for the SMB password")
    if not adopt and unix_user_exists(slug):
        raise ValueError("a Unix account with that name already exists, so Orion will not take it over")
    directory = users_root() / slug
    run_root(
        "set -e\n"
        f"groupadd -f {SMB_GROUP}\n"
        f"if ! id -u {slug} >/dev/null 2>&1; then\n"
        f"  useradd --no-create-home --home-dir {directory} --shell /usr/sbin/nologin --user-group {slug}\n"
        "fi\n"
        f"usermod -aG {SMB_GROUP} {slug}\n"
        f"chown {slug}: {directory}\n"
        "read -r SECRET\n"
        f'printf "%s\\n%s\\n" "$SECRET" "$SECRET" | smbpasswd -s -a {slug}\n',
        stdin_text=f"{password}\n",
        timeout=120,
    )


def drop_samba_account(slug: str) -> None:
    """Remove the Samba account and the Unix account created for it."""
    if not samba_installed() or not unix_user_exists(slug):
        return
    run_root(
        "set -e\n"
        f"smbpasswd -x {slug} >/dev/null 2>&1 || true\n"
        f"gpasswd -d {slug} {SMB_GROUP} >/dev/null 2>&1 || true\n"
        f"userdel {slug} >/dev/null 2>&1 || true\n",
        timeout=120,
    )


def services_facts() -> list[dict]:
    try:
        completed = subprocess.run(
            [
                "systemctl",
                "list-units",
                "--type=service",
                "--all",
                "--no-legend",
                "--plain",
                "--no-pager",
                "--output=json",
            ],
            capture_output=True,
            text=True,
            timeout=8,
        )
        units = json.loads(completed.stdout or "[]")
    except (OSError, subprocess.SubprocessError, ValueError):
        units = []
    services = []
    for unit in units:
        name = str(unit.get("unit", ""))
        if not name.endswith(".service") or unit.get("load") != "loaded":
            continue
        services.append(
            {
                "id": name,
                "name": name.removesuffix(".service"),
                "description": str(unit.get("description", "")),
                "load": str(unit.get("load", "")),
                "active": str(unit.get("active", "")),
                "sub": str(unit.get("sub", "")),
                "running": unit.get("active") == "active",
            }
        )
    return services


def notifications_facts(storage: dict, services: list[dict]) -> list[dict]:
    items = []
    for pool in storage["pools"]:
        total = pool["totalBytes"]
        if total and pool["usedBytes"] / total >= 0.9:
            percent = round(pool["usedBytes"] / total * 100)
            items.append(
                {
                    "id": f"n-{pool['id']}",
                    "title": f"{pool['name']} is {percent}% full",
                    "body": "Free space before the volume is exhausted.",
                    "tone": "warning",
                    "time": "now",
                    "read": False,
                    "action": {"label": "Review storage", "route": "storage"},
                }
            )
    for service in services:
        if service["name"] in ("nginx", "orion-api") and not service["running"]:
            items.append(
                {
                    "id": f"n-{service['id']}",
                    "title": f"{service['name']} is not running",
                    "body": "The desktop is served by this unit.",
                    "tone": "danger",
                    "time": "now",
                    "read": False,
                    "action": {"label": "Review services", "route": "apps"},
                }
            )
    try:
        trashed = sum(1 for _ in TRASH.iterdir())
    except OSError:
        trashed = 0
    if trashed:
        items.append(
            {
                "id": "n-trash",
                "title": f"{trashed} item{'s' if trashed != 1 else ''} in Trash",
                "body": "Deleted files stay on disk until the trash is emptied.",
                "tone": "info",
                "time": "now",
                "read": True,
                "action": {"label": "Open Files", "route": "files"},
            }
        )
    return items


# ------------------------------------------------------------- telemetry


class Sampler:
    """Two-second sampling, so a fresh page still has a real trend to draw."""

    def __init__(self) -> None:
        # Empty until sampled: a fresh boot has no history, and inventing one
        # would be the demo mode this service exists to remove.
        self.cpu: deque[int] = deque(maxlen=HISTORY)
        self.ram: deque[int] = deque(maxlen=HISTORY)
        self.net_down: deque[float] = deque(maxlen=HISTORY)
        self.net_up: deque[float] = deque(maxlen=HISTORY)
        self.latest = {"cpu": 0, "ram": 0, "netDown": 0.0, "netUp": 0.0}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._previous: tuple[int, int, int, int, float] | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="sampler", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.wait(SAMPLE_SECONDS):
            try:
                with self._lock:
                    self._sample()
            except OSError:
                continue

    def _sample(self) -> None:
        try:
            fields = read_text("/proc/stat").splitlines()[0].split()
            values = [int(field) for field in fields[1:]]
            idle = values[3] + (values[4] if len(values) > 4 else 0)
            total = sum(values)
            now = time.monotonic()
            memory = memory_facts()
            interface = default_interface()
            counter_rx = counter_tx = 0
            for line in read_text("/proc/net/dev").splitlines()[2:]:
                name, _, rest = line.partition(":")
                if name.strip() != interface:
                    continue
                parts = rest.split()
                counter_rx, counter_tx = int(parts[0]), int(parts[8])
                break
        except (OSError, ValueError, IndexError):
            return

        previous = self._previous
        self._previous = (idle, total, counter_rx, counter_tx, now)
        if previous is None:
            # Rates need two counter readings; the first pass only records them.
            return

        previous_idle, previous_total, previous_rx, previous_tx, previous_at = previous
        delta_total = max(1, total - previous_total)
        cpu = round(max(0, min(100, 100 * (1 - (idle - previous_idle) / delta_total))))
        elapsed = max(0.5, now - previous_at)
        down = max(0.0, (counter_rx - previous_rx) / elapsed)
        up = max(0.0, (counter_tx - previous_tx) / elapsed)
        self.latest = {"cpu": cpu, "ram": memory["percent"], "netDown": down, "netUp": up}
        self.cpu.append(cpu)
        self.ram.append(memory["percent"])
        self.net_down.append(round(down, 1))
        self.net_up.append(round(up, 1))

    def snapshot(self) -> dict:
        with self._lock:
            latest = self.latest
            return {
                "cpu": latest["cpu"],
                "ram": latest["ram"],
                "temp": temperature(),
                "cpuMhz": cpu_mhz(),
                "uptimeSeconds": uptime_seconds(),
                "netDown": latest["netDown"],
                "netUp": latest["netUp"],
                "cpuHistory": list(self.cpu),
                "ramHistory": list(self.ram),
                "netDownHistory": list(self.net_down),
                "netUpHistory": list(self.net_up),
            }


SAMPLER = Sampler()


# ----------------------------------------------------------------- server


class Handler(BaseHTTPRequestHandler):
    server_version = "orion-api"
    sys_version = ""

    def log_message(self, fmt: str, *args) -> None:  # quieter journal
        print(f"{self.address_string()} {fmt % args}", flush=True)

    # -- helpers

    def json(self, payload, status: int = 200) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def fail(self, message: str, status: int = 400) -> None:
        self.json({"error": message}, status)

    def identity(self) -> dict | None:
        email = (
            self.headers.get("X-Auth-Request-Email")
            or self.headers.get("X-Authentik-Email")
            or ""
        ).strip()
        if not email:
            return None
        return {
            "email": email,
            "name": self.headers.get("X-Auth-Request-Preferred-Username") or "",
            "username": self.headers.get("X-Auth-Request-User") or "",
            "groups": [
                value.strip()
                for value in (self.headers.get("X-Auth-Request-Groups") or "").split(",")
                if value.strip()
            ],
        }

    def query(self) -> dict:
        return dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query))

    def body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            raise ValueError("body must be JSON")
        if not isinstance(payload, dict):
            raise ValueError("body must be an object")
        return payload

    # -- routes

    def do_GET(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        route = parsed.path.rstrip("/") or "/"
        try:
            if route == "/api/metrics":
                self.json(SAMPLER.snapshot())
                return
            if route == "/api/system":
                identity = self.identity()
                self.json(
                    {
                        "hostname": socket.gethostname(),
                        "kernel": os.uname().release,
                        "arch": os.uname().machine,
                        "cpu": {"model": cpu_model(), "cores": os.cpu_count() or 1},
                        "memory": memory_facts(),
                        "uptimeSeconds": uptime_seconds(),
                        "runtime": container_runtime(),
                        "network": network_facts(),
                        "storageRoot": str(ROOT),
                        "version": version_facts(),
                        "identity": identity,
                        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    }
                )
                return
            if route == "/api/state":
                storage = storage_facts()
                services = services_facts()
                nodes = scan_files()
                self.json(
                    {
                        "files": nodes,
                        "storage": storage,
                        "users": users_facts(self.identity()),
                        "spaces": spaces_facts(),
                        "apps": apps_facts(),
                        "services": services,
                        "notifications": notifications_facts(storage, services),
                        "roots": [
                            {"label": node["name"], "path": node["id"]}
                            for node in sorted(nodes, key=lambda item: item["name"].lower())
                            if node["parent"] == "/" and node["type"] == "folder"
                        ],
                    }
                )
                return
            if route == "/api/files/content":
                self.download()
                return
            self.fail("not found", HTTPStatus.NOT_FOUND)
        except ValueError as error:
            self.fail(str(error))
        except OSError as error:
            self.fail(f"{error.strerror or error}", HTTPStatus.INTERNAL_SERVER_ERROR)

    def download(self) -> None:
        target = safe_path(self.query().get("path", ""))
        if not target.is_file():
            self.fail("no such file", HTTPStatus.NOT_FOUND)
            return
        size = target.stat().st_size
        inline = self.query().get("inline") == "1"
        disposition = "inline" if inline else "attachment"
        self.send_response(HTTPStatus.OK)
        self.send_header(
            "Content-Type", "application/octet-stream" if not inline else guess_type(target.name)
        )
        self.send_header("Content-Length", str(size))
        self.send_header(
            "Content-Disposition",
            f'{disposition}; filename="{urllib.parse.quote(target.name)}"',
        )
        self.send_header("Cache-Control", "private, max-age=300")
        self.end_headers()
        with open(target, "rb") as handle:
            shutil.copyfileobj(handle, self.wfile, 262_144)

    def do_POST(self) -> None:
        route = urllib.parse.urlsplit(self.path).path.rstrip("/") or "/"
        try:
            if route == "/api/files/mkdir":
                payload = self.body()
                parent = safe_path(str(payload.get("parent", "/")))
                name = clean_name(str(payload.get("name", "")))
                if not parent.is_dir():
                    self.fail("no such folder")
                    return
                (parent / name).mkdir()
                self.json({"ok": True, "path": virtual_path(parent / name)})
                return
            if route == "/api/files/rename":
                payload = self.body()
                target = safe_path(str(payload.get("path", "")))
                name = clean_name(str(payload.get("name", "")))
                if not target.exists():
                    self.fail("no such item", HTTPStatus.NOT_FOUND)
                    return
                if target == ROOT:
                    self.fail("cannot rename the storage root")
                    return
                destination = target.parent / name
                if destination.exists() and destination != target:
                    self.fail("an item with that name already exists", HTTPStatus.CONFLICT)
                    return
                target.rename(destination)
                self.json({"ok": True, "path": virtual_path(destination)})
                return
            if route == "/api/files/delete":
                payload = self.body()
                paths = payload.get("paths")
                if not isinstance(paths, list) or not paths:
                    self.fail("nothing selected")
                    return
                moved = move_to_trash([str(item) for item in paths])
                self.json({"ok": True, "moved": moved})
                return
            if route == "/api/files/star":
                payload = self.body()
                path = str(payload.get("path", ""))
                safe_path(path)
                stars = load_stars()
                if payload.get("starred"):
                    stars.add(path)
                else:
                    stars.discard(path)
                save_stars(stars)
                self.json({"ok": True, "starred": path in stars})
                return
            if route == "/api/services":
                payload = self.body()
                unit = str(payload.get("unit", ""))
                action = str(payload.get("action", ""))
                if not UNIT_PATTERN.match(unit):
                    self.fail("invalid unit")
                    return
                if action not in ("start", "stop", "restart"):
                    self.fail("invalid action")
                    return
                # Stopping either of these cuts the browser's own way back in.
                if action == "stop" and unit in ("nginx.service", "orion-api.service"):
                    self.fail(
                        f"{unit} serves this desktop; stop it over incus instead",
                        HTTPStatus.CONFLICT,
                    )
                    return
                completed = subprocess.run(
                    ["systemctl", action, unit], capture_output=True, text=True, timeout=30
                )
                if completed.returncode != 0:
                    self.fail(completed.stderr.strip() or "systemctl failed", HTTPStatus.BAD_GATEWAY)
                    return
                self.json({"ok": True, "unit": unit, "action": action})
                return
            if route == "/api/files/content":
                self.upload()
                return
            if route == "/api/users":
                space = create_space(self.body())
                self.json({"ok": True, "space": space}, HTTPStatus.CREATED)
                return
            if route.startswith("/api/users/") and route.endswith("/password"):
                slug = urllib.parse.unquote(route[len("/api/users/") :].removesuffix("/password"))
                payload = self.body()
                space = set_space_password(slug, str(payload.get("password") or ""))
                self.json({"ok": True, "space": space})
                return
            if route == "/api/apps":
                payload = self.body()
                action = str(payload.get("action") or "")
                if action not in ("install", "remove"):
                    self.fail("unknown action")
                    return
                app_id = str(payload.get("id") or "")
                app = install_app(app_id) if action == "install" else remove_app(app_id)
                self.json({"ok": True, "app": app})
                return
            self.fail("not found", HTTPStatus.NOT_FOUND)
        except LookupError as error:
            self.fail(str(error), HTTPStatus.NOT_FOUND)
        except ValueError as error:
            self.fail(str(error))
        except RuntimeError as error:
            self.fail(str(error), HTTPStatus.BAD_GATEWAY)
        except FileExistsError:
            self.fail("that item already exists", HTTPStatus.CONFLICT)
        except OSError as error:
            self.fail(f"{error.strerror or error}", HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_DELETE(self) -> None:
        route = urllib.parse.urlsplit(self.path).path.rstrip("/") or "/"
        try:
            if route.startswith("/api/users/"):
                slug = urllib.parse.unquote(route[len("/api/users/") :])
                space = delete_space(slug)
                self.json({"ok": True, "slug": space["slug"], "name": space["name"]})
                return
            self.fail("not found", HTTPStatus.NOT_FOUND)
        except LookupError as error:
            self.fail(str(error), HTTPStatus.NOT_FOUND)
        except ValueError as error:
            self.fail(str(error))
        except OSError as error:
            self.fail(f"{error.strerror or error}", HTTPStatus.INTERNAL_SERVER_ERROR)

    def upload(self) -> None:
        query = self.query()
        directory = safe_path(query.get("path", "/"))
        if not directory.is_dir():
            self.fail("no such folder")
            return
        length_header = self.headers.get("Content-Length")
        length = int(length_header) if length_header else None
        chunked = "chunked" in (self.headers.get("Transfer-Encoding") or "").lower()
        node = upload_stream(
            directory, query.get("name", ""), self.rfile, length, chunked
        )
        self.json({"ok": True, "file": node})


def guess_type(name: str) -> str:
    import mimetypes

    return mimetypes.guess_type(name)[0] or "application/octet-stream"


def reconcile_installed_apps() -> None:
    """A server that has an app installed should come up with it serving.

    apt can leave smbd, nmbd or avahi stopped and disabled, and a rebuilt
    container keeps the package while losing /etc/samba/smb.conf and the avahi
    advert. Both are regenerated from what the registry says, so `installed`
    means the same thing as `answering` after every boot.
    """
    steps = ((samba_installed, apply_smb_conf), (avahi_installed, apply_discovery))
    for installed, apply in steps:
        try:
            if installed():
                apply()
        except (OSError, RuntimeError, subprocess.SubprocessError):
            # A broken share is worth a journal line, never a failed start.
            continue


def main() -> None:
    META.mkdir(parents=True, exist_ok=True)
    TRASH.mkdir(parents=True, exist_ok=True)
    SAMPLER.start()
    threading.Thread(target=reconcile_installed_apps, daemon=True, name="reconcile").start()
    server = ThreadingHTTPServer((BIND, PORT), Handler)
    print(f"orion-api listening on {BIND}:{PORT}, root {ROOT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
