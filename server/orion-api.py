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
import shlex
import shutil
import socket
import subprocess
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(os.environ.get("ORION_ROOT", "/srv/storage")).resolve()
META = ROOT / ".orion"
TRASH = META / "trash"
STARS = META / "starred.json"
# Where each item in the trash came from, so a restore puts it back rather than
# dropping it at the root. The registry lives beside the trash, not inside it.
TRASH_INDEX = META / "trash.json"
SPACES = META / "spaces.json"
USERS_DIR_NAME = "Users"
# Administration is two levels. A platform admin owns the box and every
# account on it; an agency admin owns the people under their own space. The
# role is data matched against the signed-in address, not a property of the
# proxy session, so it survives a new login and a new browser.
PLATFORM_ROLE = "Platform admin"
AGENCY_ROLE = "Agency admin"
SPACE_ROLES = (AGENCY_ROLE, "Member", "Guest")
# Roles from before this model existed: an Owner or Admin ran their people, so
# that is what they keep meaning.
LEGACY_ROLES = {"owner": AGENCY_ROLE, "admin": AGENCY_ROLE}
PLATFORM_ADMINS = META / "platform-admins.json"
# The last machine Samba reported on each share. smbstatus only knows about
# sessions that are open right now, so this is what lets the share dialog say
# "connected an hour ago" instead of "never connected".
SHARE_CLIENTS = META / "share-clients.json"
# A provider group that grants the same thing without editing a file here.
PLATFORM_GROUP = "orion-platform-admins"
SPACE_PALETTE = ["#0a63ff", "#8b5cf6", "#10b981", "#f59e0b", "#f43f5e", "#06b6d4"]
# An address is a record, not a credential: it is what a space is filed under,
# and what the desktop matches a signed-in person against.
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SMB_CONF = Path("/etc/samba/smb.conf")
SMB_CONF_BACKUP = Path("/etc/samba/smb.conf.orion-backup")
SMB_GROUP = "orion-nas"
# One name for the box on the LAN, whatever protocol a client speaks.
DISCOVERY_NAME = "orion-nas"
NETBIOS_NAME = "ORION-NAS"
WORKGROUP = "WORKGROUP"
AVAHI_CONF = Path("/etc/avahi/avahi-daemon.conf")
AVAHI_SERVICE = Path("/etc/avahi/services/orion-smb.service")
# wsdd ships no unit on Ubuntu, only the binary, so Orion writes this one.
WSDD_UNIT = Path("/etc/systemd/system/wsdd.service")
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
        # Tried, twice, and both are refused by this container rather than by
        # Orion: kernel nfsd needs a filesystem it cannot mount, and the
        # userspace server needs open_by_handle_at, which the sandbox answers
        # with ENOSYS — it installs, starts, lists on 2049, and then returns EIO
        # for every client operation. A card that offered Install would be
        # selling something that cannot work, so it says so instead.
        "id": "nfs",
        "name": "NFS server",
        "tagline": "Exports run on the incus host, not in this container",
        "description": (
            "Kernel nfsd is a filesystem this container cannot mount, and nfs-ganesha, the "
            "userspace server, needs open_by_handle_at — refused here, so every mount fails "
            "with an I/O error. Linux and macOS mount the same shares over SMB; a native NFS "
            "export has to run on the host that holds the storage."
        ),
        "category": "Sharing",
        "packages": [],
        "unit": "",
        "available": False,
        "unavailable": (
            "No NFS server can run inside this container. Mount the SMB shares instead, or "
            "export the storage from the incus host — README, NFS."
        ),
        "hint": "host export: /etc/exports.d/orion.exports",
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
    {
        "id": "wsd",
        "name": "Windows discovery",
        "tagline": f"Listed under Network as {NETBIOS_NAME}",
        "description": (
            "Runs wsdd, the Web Service Discovery host daemon. Windows 10 and 11 dropped "
            "NetBIOS browsing, so SMB alone is invisible in Explorer's Network view; this is "
            "what puts the box there, under its own name and workgroup."
        ),
        "category": "Network",
        "packages": ["wsdd"],
        "unit": "wsdd.service",
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


def load_trash_index() -> dict:
    """The stored name of each trashed item, and the path it came from."""
    try:
        payload = json.loads(TRASH_INDEX.read_text())
    except (OSError, ValueError):
        return {}
    entries = payload.get("entries") if isinstance(payload, dict) else None
    return entries if isinstance(entries, dict) else {}


def save_trash_index(entries: dict) -> None:
    META.mkdir(parents=True, exist_ok=True)
    temporary = TRASH_INDEX.with_name(TRASH_INDEX.name + ".tmp")
    temporary.write_text(json.dumps({"entries": entries}, indent=2) + "\n")
    temporary.replace(TRASH_INDEX)


def move_to_trash(paths: list[str]) -> int:
    """Move items aside, writing down where they came from first.

    The path is recorded before the move because after it there is nothing left
    to read it from, and a restore that cannot say where an item belongs is a
    restore into the root folder — not what anybody pressed.
    """
    TRASH.mkdir(parents=True, exist_ok=True)
    index = load_trash_index()
    moved = 0
    for virtual in paths:
        target = safe_path(virtual)
        if target == ROOT or not target.exists():
            continue
        destination = unique_child(TRASH, target.name)
        index[destination.name] = {
            "original": virtual_path(target),
            "deletedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "type": "folder" if target.is_dir() else "file",
        }
        shutil.move(str(target), str(destination))
        moved += 1
    save_trash_index(index)
    return moved


def trash_entries() -> list[Path]:
    if not TRASH.is_dir():
        return []
    try:
        return list(TRASH.iterdir())
    except OSError:
        return []


def trash_count() -> int:
    return len(trash_entries())


def trash_facts() -> dict:
    """What is in the trash, where each item came from, and how big it is.

    The registry is pruned on read, the same way the spaces registry is: an item
    emptied by hand outside this app must stop appearing, and a record whose item
    is gone must not keep a phantom row alive.
    """
    index = load_trash_index()
    items = []
    kept = {}
    total = 0
    for entry in trash_entries():
        record = index.get(entry.name) or {}
        try:
            modified = entry.stat().st_mtime
            size = folder_bytes(entry) if entry.is_dir() and not entry.is_symlink() else entry.stat().st_size
        except OSError:
            continue
        kept[entry.name] = record
        total += size
        items.append(
            {
                "name": entry.name,
                "original": str(record.get("original") or ""),
                "type": "folder" if entry.is_dir() and not entry.is_symlink() else "file",
                "size": size,
                "deletedAt": str(
                    record.get("deletedAt")
                    or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(modified))
                ),
            }
        )
    if kept != index:
        try:
            save_trash_index(kept)
        except OSError:
            pass
    items.sort(key=lambda item: item["deletedAt"], reverse=True)
    return {"items": items, "bytes": total}


def restore_from_trash(name: str) -> dict:
    """Put one item back where it was deleted from."""
    name = str(name or "").strip()
    if not name or "/" in name or name in (".", ".."):
        raise ValueError("unknown trash item")
    source = TRASH / name
    if not source.exists():
        raise LookupError("that item is no longer in Trash")
    index = load_trash_index()
    record = index.get(name) or {}
    original = str(record.get("original") or "").strip()
    destination = safe_path(original) if original else ROOT / name
    parent = destination.parent
    if parent == TRASH or not parent.is_dir():
        raise ValueError("the folder it came from is gone, so it cannot go back")
    if destination.exists():
        # Something new lives there now; keep both rather than overwrite it.
        destination = unique_child(parent, destination.name)
    shutil.move(str(source), str(destination))
    index.pop(name, None)
    save_trash_index(index)
    return {"path": virtual_path(destination), "name": destination.name}


def empty_trash() -> int:
    """Unlink everything in the trash. This is the one irreversible action."""
    removed = 0
    for entry in trash_entries():
        try:
            if entry.is_dir() and not entry.is_symlink():
                shutil.rmtree(entry)
            else:
                entry.unlink()
            removed += 1
        except OSError:
            continue
    save_trash_index({})
    return removed


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


def users_facts(identity: dict | None, session: dict | None = None) -> list[dict]:
    """The people this app knows: the signed-in person, and the spaces an admin
    issued. The container's own Unix accounts are not app users — root and
    ubuntu are plumbing, and listing them made the desktop look like it had
    signed in as root.

    Each row carries `manageable`, so the UI never has to re-derive who may
    touch whom from a role string.
    """
    session = session or session_facts(identity)
    users = []
    if identity and identity.get("email"):
        users.append(
            {
                "id": "sso",
                "name": identity.get("name") or identity["email"].split("@")[0],
                "email": identity["email"],
                "role": session.get("role") or "Member",
                "lastActive": "This session",
                "color": "#0a63ff",
                "isCurrent": True,
                "account": identity.get("username") or "",
                "home": "",
                "source": "authentik",
                "manageable": False,
            }
        )
    for index, space in enumerate(load_spaces()):
        users.append(
            {
                "id": f"space-{space['slug']}",
                "name": str(space.get("name") or space["slug"]),
                "email": str(space.get("email") or f"{space['slug']}@nas"),
                "role": normalise_role(space.get("role")),
                "agency": str(space.get("agency") or ""),
                "lastActive": "Space · admin issued",
                "color": str(space.get("color") or SPACE_PALETTE[index % len(SPACE_PALETTE)]),
                "isCurrent": False,
                "account": str(space["slug"]),
                "home": f"/{USERS_DIR_NAME}/{space['slug']}",
                "source": "space",
                "manageable": can_manage_space(space, session),
            }
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


def normalise_role(value: object) -> str:
    """One of the three roles this app knows, whatever the old value was."""
    text = str(value or "").strip().lower()
    if text in LEGACY_ROLES:
        return LEGACY_ROLES[text]
    for role in SPACE_ROLES:
        if role.lower() == text:
            return role
    return "Member"


def load_platform_admins() -> list[str]:
    try:
        payload = json.loads(PLATFORM_ADMINS.read_text())
    except (OSError, ValueError):
        return []
    emails = payload.get("emails") if isinstance(payload, dict) else None
    return [str(item).strip().lower() for item in emails or [] if str(item).strip()]


def save_platform_admins(emails: list[str]) -> None:
    META.mkdir(parents=True, exist_ok=True)
    temporary = PLATFORM_ADMINS.with_name(PLATFORM_ADMINS.name + ".tmp")
    temporary.write_text(json.dumps({"emails": emails}, indent=2) + "\n")
    temporary.replace(PLATFORM_ADMINS)


def space_by_email(email: str) -> dict | None:
    """The person's space for this address. A shared space has no owner, so a
    household address never becomes somebody's own folder."""
    wanted = email.strip().lower()
    return next(
        (
            space
            for space in load_spaces()
            if not space.get("shared")
            and str(space.get("email") or "").strip().lower() == wanted
        ),
        None,
    )


def session_facts(identity: dict | None) -> dict:
    """Who is asking, and which accounts they may administer.

    The first address to reach a box with no platform admins recorded becomes
    one, so a fresh install cannot lock itself out; after that the registry in
    `.orion/platform-admins.json` — or membership of the provider's
    `orion-platform-admins` group — decides.
    """
    anonymous = {
        "role": "Anonymous",
        "email": "",
        "agency": "",
        "permissions": {"manageUsers": False, "scope": "none", "agency": ""},
    }
    if not identity or not identity.get("email"):
        return anonymous
    email = str(identity["email"]).strip().lower()
    admins = load_platform_admins()
    groups = {str(group).strip().lower() for group in identity.get("groups") or []}
    platform = email in admins or PLATFORM_GROUP in groups
    if not platform and not admins:
        try:
            save_platform_admins([email])
            platform = True
        except OSError:
            platform = False
    if platform:
        return {
            "role": PLATFORM_ROLE,
            "email": email,
            "agency": "",
            "permissions": {"manageUsers": True, "scope": "all", "agency": ""},
        }
    space = space_by_email(email)
    if space is not None and normalise_role(space.get("role")) == AGENCY_ROLE:
        slug = str(space["slug"])
        return {
            "role": AGENCY_ROLE,
            "email": email,
            "agency": slug,
            "permissions": {"manageUsers": True, "scope": "agency", "agency": slug},
        }
    return {
        "role": "Member",
        "email": email,
        "agency": str(space["slug"]) if space else "",
        "permissions": {"manageUsers": False, "scope": "none", "agency": ""},
    }


def can_manage_space(space: dict, session: dict) -> bool:
    """May this session add, remove or re-key that account?"""
    permissions = session.get("permissions") or {}
    if not permissions.get("manageUsers"):
        return False
    if permissions.get("scope") == "all":
        return True
    agency = str(permissions.get("agency") or "")
    slug = str(space.get("slug") or "")
    # An agency admin runs the people filed under them; their own space is the
    # agency, and removing it would remove the identity the role is matched on.
    return bool(agency) and str(space.get("agency") or "") == agency and slug != agency


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


def space_facts(
    space: dict, index: int, session: dict | None = None, clients: dict | None = None
) -> dict:
    slug = str(space["slug"])
    if clients is None:
        # Callers that answer about one space (create, remove, role change) do
        # not have the whole list; asking here keeps their answer true.
        clients = share_client_map([space])
    seen = clients.get(slug) or {}
    smb = bool(space.get("smb")) and samba_installed()
    return {
        "id": slug,
        "slug": slug,
        "name": str(space.get("name") or slug),
        "email": str(space.get("email") or ""),
        "role": normalise_role(space.get("role")),
        "agency": str(space.get("agency") or ""),
        "signin": str(space.get("signin") or ""),
        # Shared with every account on the box rather than only its own.
        "shared": bool(space.get("shared")),
        "manageable": can_manage_space(space, session) if session else False,
        "path": f"/{USERS_DIR_NAME}/{slug}",
        "usedBytes": folder_bytes(users_root() / slug),
        "createdAt": str(space.get("createdAt") or ""),
        "color": str(space.get("color") or SPACE_PALETTE[index % len(SPACE_PALETTE)]),
        "smb": smb,
        # Who is on the share right now, and who was last: what the dialog needs
        # to say something better than "try this path".
        "clients": list(seen.get("clients") or []) if smb else [],
        "lastClient": (seen.get("lastClient") or None) if smb else None,
    }


def spaces_facts(session: dict | None = None) -> list[dict]:
    """Registered spaces whose folder still exists; a folder deleted in Files drops out."""
    spaces = load_spaces()
    present = [space for space in spaces if (users_root() / str(space["slug"])).is_dir()]
    if len(present) != len(spaces):
        try:
            save_spaces(present)
        except OSError:
            pass
    # Asked once per request rather than once per space: it shells out to
    # smbstatus, and every space has the same answer to give about itself.
    clients = share_client_map(present)
    return [space_facts(space, index, session, clients) for index, space in enumerate(present)]


def create_space(
    payload: dict,
    session: dict | None = None,
    provision: bool = True,
    granted: bool = False,
) -> dict:
    """Add a person. Who may do so, and for whom, is decided here rather than
    in the browser: a platform admin anywhere, an agency admin only under their
    own agency and never as another agency admin.

    `granted` is for the one caller that is not an administrator: a signed-in
    person creating their own space (`create_own_space`). `provision` is false
    there too, because they already have a directory account — making one would
    delete the account they signed in with.
    """
    session = session or session_facts(None)
    permissions = session.get("permissions") or {}
    if not granted and not permissions.get("manageUsers"):
        raise PermissionError("only an administrator can add accounts")
    name = str(payload.get("name", "")).strip()
    email = str(payload.get("email", "")).strip().lower()
    role = normalise_role(payload.get("role"))
    if len(name) < 2:
        raise ValueError("give the person a name")
    if len(name) > 80:
        raise ValueError("keep names under 80 characters")
    if email and not EMAIL_PATTERN.match(email):
        raise ValueError("that email address does not look right")

    spaces = load_spaces()
    if email and any(str(space.get("email", "")).lower() == email for space in spaces):
        raise ValueError("a space with that email already exists")

    agency = str(payload.get("agency") or "").strip()
    if permissions.get("scope") == "agency":
        agency = str(permissions.get("agency") or "")
        if role == AGENCY_ROLE:
            raise PermissionError("only a platform admin can appoint another agency admin")
    if agency:
        sponsor = next((item for item in spaces if str(item["slug"]) == agency), None)
        if sponsor is None or normalise_role(sponsor.get("role")) != AGENCY_ROLE:
            raise ValueError("that agency does not exist")

    root = users_root()
    root.mkdir(parents=True, exist_ok=True)
    # A caller may pin the account name (their own username, so Windows sees the
    # name they log in with); otherwise it comes from the person's name.
    base = slug_for(str(payload.get("username") or name))
    slug = base
    counter = 2
    while any(str(space["slug"]) == slug for space in spaces) or (root / slug).exists():
        slug = f"{base}-{counter}"
        counter += 1
    password = str(payload.get("password") or "")
    (root / slug).mkdir()
    signin = ""
    try:
        if password:
            write_smb_password(slug, name, password, adopt=False)
        # A person with an address can sign in as well as mount the share, but
        # only where the host has directory credentials. One password for both,
        # and the account is born in the group the edge proxy lets through.
        if provision and password and email and directory_ready():
            signin = create_signin(slug, name, email, password)
        smb = bool(password)
    except Exception:
        # Nothing half-created, whatever went wrong: the folder and any Unix
        # account it made go back. A bug in the directory client must not leave
        # a person's folder behind with no account to match it.
        if password:
            try:
                drop_samba_account(slug)
            except (OSError, RuntimeError, subprocess.SubprocessError):
                pass
        shutil.rmtree(root / slug, ignore_errors=True)
        raise

    if role == AGENCY_ROLE:
        # An agency admin's own space *is* the agency, so people they add are
        # filed under it and they cannot remove it from under themselves.
        agency = slug
    space = {
        "slug": slug,
        "name": name,
        "email": email,
        "role": role,
        "agency": agency,
        "color": SPACE_PALETTE[len(spaces) % len(SPACE_PALETTE)],
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "smb": smb,
        "signin": signin,
    }
    save_spaces([*spaces, space])
    if smb:
        apply_smb_conf()
    return space_facts(space, len(spaces), session)


def delete_space(slug: str, session: dict | None = None) -> dict:
    session = session or session_facts(None)
    slug = str(slug or "").strip()
    if not slug or "/" in slug or slug in (".", ".."):
        raise ValueError("unknown space")
    spaces = load_spaces()
    space = next((item for item in spaces if str(item["slug"]) == slug), None)
    if space is None:
        raise LookupError("that person has no space on this host")
    if not can_manage_space(space, session):
        raise PermissionError("you can only remove people in your own agency")

    if space.get("signin"):
        # Stop the sign-in before the folder goes: a live login with no space
        # would still open the desktop. An unreachable directory aborts the
        # removal rather than leaving an account nobody can see any more.
        disable_signin(str(space["signin"]))
    if space.get("smb"):
        drop_samba_account(slug)
    target = users_root() / slug
    if target.is_dir():
        # Same rule as the Files app: deleting moves to Trash, never unlinks.
        TRASH.mkdir(parents=True, exist_ok=True)
        shutil.move(str(target), str(unique_child(TRASH, slug)))
    remaining = [item for item in spaces if str(item["slug"]) != slug]
    for item in remaining:
        # The agency is gone: its people keep their folders but are no longer
        # filed under an administrator who cannot exist any more.
        if str(item.get("agency") or "") == slug:
            item["agency"] = ""
    save_spaces(remaining)
    # The remembered machine belonged to a share that no longer exists.
    forget_share_clients(slug)
    if samba_installed():
        apply_smb_conf()
    return space_facts(space, 0, session)


def set_space_password(slug: str, password: str, session: dict | None = None) -> dict:
    """Give an existing space an SMB account, or reset the one it has.

    A space that also has a directory account keeps one password: the same one
    signs in at the edge and opens the share, which is what an administrator
    handing somebody a password expects.
    """
    session = session or session_facts(None)
    spaces = load_spaces()
    space = next((item for item in spaces if str(item["slug"]) == slug), None)
    if space is None:
        raise LookupError("that person has no space on this host")
    if not can_manage_space(space, session):
        raise PermissionError("you can only re-key people in your own agency")
    write_smb_password(
        slug, str(space.get("name") or slug), password, adopt=bool(space.get("smb"))
    )
    space["smb"] = True
    if space.get("signin"):
        # The share and the sign-in are one credential; a reset that only moved
        # half of it would lock the person out of the desktop they still mount.
        update_signin_password(str(space["signin"]), password)
    save_spaces(spaces)
    apply_smb_conf()
    return space_facts(space, spaces.index(space), session)


def create_own_space(identity: dict | None, payload: dict, session: dict | None = None) -> dict:
    """The signed-in person's own folder, named after their account.

    Anybody may do this once, for themselves: a space is a folder, and asking an
    administrator for your own folder is friction with no security in it. The
    account name is their provider username where there is one, which is the
    name Windows will ask for. No directory account is created — they are here
    because they already have one.
    """
    if not identity or not identity.get("email"):
        raise PermissionError("sign in first: a space belongs to an address")
    email = str(identity["email"]).strip().lower()
    existing = space_by_email(email)
    if existing is not None:
        raise ValueError(f"you already have a space: {existing['slug']}")
    username = slug_for(
        str(identity.get("username") or identity.get("name") or email.split("@")[0])
    )
    if any(str(space["slug"]) == username for space in load_spaces()):
        raise ValueError("a space already uses your account name; ask an administrator")
    name = str(identity.get("name") or identity.get("username") or email)
    return create_space(
        {
            "name": name,
            "email": email,
            "role": "Member",
            "username": username,
            "password": str(payload.get("password") or ""),
        },
        session,
        provision=False,
        granted=True,
    )


def change_own_password(identity: dict | None, password: str) -> dict:
    """Reset the password the signed-in person signs in and mounts with.

    Only ever the caller's own account: the target is derived from the forwarded
    identity, never from the request, so this route cannot be pointed at somebody
    else. The share is created on the first call if they had none.
    """
    if not identity or not identity.get("email"):
        raise PermissionError("sign in first: the password belongs to an address")
    if len(password) < 8:
        raise ValueError("use at least 8 characters")
    email = str(identity["email"]).strip().lower()
    username = slug_for(
        str(identity.get("username") or identity.get("name") or email.split("@")[0])
    )
    spaces = load_spaces()
    space = space_by_email(email) or next(
        (item for item in spaces if str(item["slug"]) == username), None
    )
    changed_share = False
    if space is not None and samba_installed():
        write_smb_password(
            str(space["slug"]),
            str(space.get("name") or space["slug"]),
            password,
            adopt=bool(space.get("smb")),
        )
        space["smb"] = True
        save_spaces(spaces)
        apply_smb_conf()
        changed_share = True
    changed_signin = False
    if directory_ready() and directory_user(username) is not None:
        update_signin_password(username, password)
        changed_signin = True
    if not changed_share and not changed_signin:
        raise ValueError(
            "this host has neither a share nor a directory account for you yet"
        )
    return {
        "share": changed_share,
        "signin": changed_signin,
        "slug": str(space["slug"]) if space else "",
    }


def remove_share(slug: str, session: dict | None = None) -> dict:
    """Take a space off the network without touching its files.

    The person keeps their folder, their sign-in and their files; what goes is
    the Samba account and the exported share, and the registry stops claiming
    the space is shared. Re-enabling is the same as setting a password again.
    """
    session = session or session_facts(None)
    spaces = load_spaces()
    space = next((item for item in spaces if str(item["slug"]) == slug), None)
    if space is None:
        raise LookupError("that person has no space on this host")
    if not can_manage_space(space, session):
        raise PermissionError("you can only change shares in your own agency")
    if not space.get("smb"):
        # Nothing to remove is not an error: the share is already gone, and the
        # registry is corrected either way.
        space["smb"] = False
        space["shared"] = False
        save_spaces(spaces)
        return space_facts(space, spaces.index(space), session)
    drop_samba_account(str(space["slug"]))
    space["smb"] = False
    # With no export left, "everyone" has nothing to open.
    space["shared"] = False
    save_spaces(spaces)
    forget_share_clients(str(space["slug"]))
    if samba_installed():
        apply_smb_conf()
    return space_facts(space, spaces.index(space), session)


def set_space_role(
    slug: str, role: object, session: dict | None = None, agency: object = ""
) -> dict:
    """Appoint an agency admin, or put one back to member.

    Only a platform admin may do this. Appointing is what makes a space the
    agency other people can be filed under; demoting releases everyone who was
    filed under it, because an agency cannot exist without its administrator.
    """
    session = session or session_facts(None)
    permissions = session.get("permissions") or {}
    if permissions.get("scope") != "all":
        raise PermissionError("only a platform admin can appoint an agency admin")
    spaces = load_spaces()
    space = next((item for item in spaces if str(item["slug"]) == slug), None)
    if space is None:
        raise LookupError("that person has no space on this host")
    # Checked before normalising: an unknown string would quietly become
    # "Member", and a demotion is not what somebody asking for platform admin
    # should get.
    if str(role or "").strip().lower() == PLATFORM_ROLE.lower():
        raise ValueError("platform admin is granted by the provider group, not here")
    wanted = normalise_role(role)
    if wanted == AGENCY_ROLE:
        space["role"] = AGENCY_ROLE
        space["agency"] = str(space["slug"])
    else:
        space["role"] = wanted
        space["agency"] = ""
        for item in spaces:
            if str(item.get("agency") or "") == str(space["slug"]):
                # Same rule as removing the space: people keep their folders,
                # but nobody is left filed under an administrator who is gone.
                item["agency"] = ""
    save_spaces(spaces)
    return space_facts(space, spaces.index(space), session)


def set_space_shared(slug: str, shared: object, session: dict | None = None) -> dict:
    """Open a share to every account on the box, or close it again.

    A shared space is the household folder: Samba admits the whole `orion-nas`
    group instead of one account, and the folder is put in that group with group
    write and the setgid bit, so what anybody creates stays writable by them all.
    Closing it puts the export back to its owner; the files keep the permissions
    they already have, because reading them was never what granted the mount.
    """
    session = session or session_facts(None)
    spaces = load_spaces()
    space = next((item for item in spaces if str(item["slug"]) == slug), None)
    if space is None:
        raise LookupError("that person has no space on this host")
    if not can_manage_space(space, session):
        raise PermissionError("you can only change shares in your own agency")
    if not space.get("smb"):
        raise ValueError("give this space a share with a password first")
    wanted = bool(shared)
    space["shared"] = wanted
    save_spaces(spaces)
    directory = users_root() / slug
    if wanted and directory.is_dir() and samba_installed():
        quoted = shlex.quote(str(directory))
        run_root(
            "set -e\n"
            f"groupadd -f {SMB_GROUP}\n"
            # Everything already there joins the group, so the first person
            # through is not the only one who can write to it.
            f"chgrp -R {SMB_GROUP} {quoted}\n"
            f"chmod -R g+rwX {quoted}\n"
            # New folders inherit the group rather than the creator's.
            f"find {quoted} -type d -exec chmod g+s {{}} +\n",
            timeout=300,
        )
    if samba_installed():
        apply_smb_conf()
    return space_facts(space, spaces.index(space), session)


def set_space_email(slug: str, email: object, session: dict | None = None) -> dict:
    """Record the address a space is filed under.

    A record, not a credential: the desktop matches a signed-in person to their
    space by it, and a shared space shows it as the household address. Nothing
    is created in the directory here — a sign-in is issued with a password, and
    changing an address is not the same act.
    """
    session = session or session_facts(None)
    spaces = load_spaces()
    space = next((item for item in spaces if str(item["slug"]) == slug), None)
    if space is None:
        raise LookupError("that person has no space on this host")
    if not can_manage_space(space, session):
        raise PermissionError("you can only change addresses in your own agency")
    address = str(email or "").strip().lower()
    if len(address) > 120:
        raise ValueError("keep addresses under 120 characters")
    if address and not EMAIL_PATTERN.match(address):
        raise ValueError("that email address does not look right")
    if address:
        for other in spaces:
            if str(other["slug"]) == slug:
                continue
            if str(other.get("email") or "").strip().lower() == address:
                raise ValueError("another space already uses that address")
    space["email"] = address
    save_spaces(spaces)
    return space_facts(space, spaces.index(space), session)


# ------------------------------------------------------------ sign-in directory
#
# A space is a folder; sign-in belongs to the identity provider. When an
# administrator adds somebody with a password, the same account is created in
# the directory and put in one group the edge proxy lets through, so the address
# the proxy forwards is the address this registry already knows. Unconfigured
# (no directory credentials on the host) the desktop behaves exactly as before:
# spaces only, and adding a person is a folder.

DIRECTORY_ENV = Path(os.environ.get("ORION_AUTHENTIK_ENV", "/etc/orion/sso-admin.env"))
SIGNIN_GROUP = "orion-users"


def directory_settings() -> dict:
    """Where the directory is and how to reach it; empty when not set up."""
    settings = {
        "url": os.environ.get("ORION_AUTHENTIK_URL", "").strip(),
        "token": os.environ.get("ORION_AUTHENTIK_TOKEN", "").strip(),
        "group": os.environ.get("ORION_AUTHENTIK_GROUP", SIGNIN_GROUP).strip() or SIGNIN_GROUP,
    }
    if (not settings["url"] or not settings["token"]) and DIRECTORY_ENV.is_file():
        try:
            for line in DIRECTORY_ENV.read_text(encoding="utf-8").splitlines():
                if line.lstrip().startswith("#") or "=" not in line:
                    continue
                name, _, value = line.partition("=")
                name = name.strip()
                value = value.strip().strip('"').strip("'")
                if name == "ORION_AUTHENTIK_URL" and not settings["url"]:
                    settings["url"] = value
                elif name == "ORION_AUTHENTIK_TOKEN" and not settings["token"]:
                    settings["token"] = value
                elif name == "ORION_AUTHENTIK_GROUP" and value:
                    settings["group"] = value
        except OSError:
            pass
    if settings["url"] and not settings["url"].rstrip("/").endswith("/api/v3"):
        settings["url"] = settings["url"].rstrip("/") + "/api/v3"
    return settings


def directory_ready() -> bool:
    settings = directory_settings()
    return bool(settings["url"] and settings["token"])


def directory_call(path: str, method: str = "GET", body: object = None) -> object:
    """One request to the provider's API. Never logs the token."""
    settings = directory_settings()
    if not (settings["url"] and settings["token"]):
        raise RuntimeError("sign-in provisioning is not configured on this host")
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(settings["url"] + path, data=data, method=method)
    request.add_header("Authorization", "Bearer " + settings["token"])
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8", "replace")
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:300]
        if error.code == 404:
            raise LookupError(f"the directory has no such record ({path})")
        raise ValueError(f"the directory refused that change: {detail}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        # A timeout has no `.reason`; an HTTP wrapper does. Say something true
        # either way instead of raising AttributeError out of an error path.
        raise RuntimeError(f"the directory is unreachable: {getattr(error, 'reason', error)}") from None


def directory_user(username: str) -> dict | None:
    found = directory_call(f"/core/users/?username={urllib.parse.quote(username)}")
    for user in (found or {}).get("results") or []:
        if str(user.get("username")) == username:
            return user
    return None


def directory_group(name: str | None = None) -> dict:
    """The group the edge proxy lets through.

    It is made once by the host's setup (deploy/sso/provision-orion-access.py),
    not here: the credential this service holds may add people to groups but
    must not create them, or it could create one that grants superuser.
    """
    wanted = name or directory_settings()["group"]
    found = directory_call(f"/core/groups/?name={urllib.parse.quote(wanted)}")
    for group in (found or {}).get("results") or []:
        if str(group.get("name")) == wanted:
            return group
    raise LookupError(
        f"the directory has no {wanted} group; run the host setup before adding people"
    )


def create_signin(username: str, name: str, email: str, password: str) -> str:
    """Create the directory account a space signs in with; returns its username.

    The credential this runs under cannot edit users (editing would let it grant
    itself superuser), so membership goes through the group's own endpoint and a
    name left over from an earlier removal is deleted rather than reused.
    """
    group = directory_group()
    existing = directory_user(username)
    if existing is not None:
        directory_call(f"/core/users/{existing['pk']}/", "DELETE")
    created = directory_call(
        "/core/users/",
        "POST",
        {
            "username": username,
            "name": name,
            "email": email,
            "path": "users",
            "type": "internal",
        },
    )
    try:
        directory_call(f"/core/groups/{group['pk']}/add_user/", "POST", {"pk": created["pk"]})
        directory_call(f"/core/users/{created['pk']}/set_password/", "POST", {"password": password})
    except (ValueError, LookupError, RuntimeError):
        # No half-made sign-in: an account with no group or no password could
        # not reach the desktop, and the space would claim one that does not work.
        try:
            directory_call(f"/core/users/{created['pk']}/", "DELETE")
        except (ValueError, LookupError, RuntimeError):
            pass
        raise
    return str(created.get("username") or username)


def update_signin_password(username: str, password: str) -> None:
    user = directory_user(username)
    if user is None:
        raise ValueError("the directory has no account for that person any more")
    directory_call(f"/core/users/{user['pk']}/set_password/", "POST", {"password": password})


def disable_signin(username: str) -> None:
    """End the sign-in. The account is deleted, not merely deactivated: the
    credential may not edit users, and an inactive account would block the same
    person being added again later."""
    user = directory_user(username)
    if user is None:
        return
    directory_call(f"/core/users/{user['pk']}/", "DELETE")


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
    # An entry nothing here can run carries no packages on purpose: dpkg would
    # report an empty list as installed.
    available = bool(app.get("available", True))
    unavailable = "" if available else str(app.get("unavailable", ""))
    installed = bool(app["packages"]) and all(
        dpkg_installed(package) for package in app["packages"]
    )
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
        "available": available,
        "unavailable": unavailable,
        "hint": str(app.get("hint", "")),
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
    if not app.get("available", True):
        # The button is already disabled; this is what the API says if pressed.
        raise RuntimeError(str(app.get("unavailable") or f"{app['name']} cannot run here"))
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
    if app["id"] == "wsd":
        # The Ubuntu package is the daemon only; the name it announces and the
        # workgroup it announces into are Orion's to set.
        apply_wsd()
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
    if app["id"] == "wsd":
        # dpkg does not own this unit file, so removing the package leaves it.
        run_root(
            "set -e\n"
            f"rm -f {WSDD_UNIT}\n"
            "systemctl daemon-reload >/dev/null 2>&1 || true\n",
            timeout=60,
        )
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
        f"   workgroup = {WORKGROUP}",
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
        shared = bool(space.get("shared"))
        lines += [
            f"[{label}]",
            f"   comment = {label} ({'every account' if shared else 'private space'})",
            f"   path = {users_root() / slug}",
            "   browseable = yes",
            "   read only = no",
            # A household folder admits the whole group and keeps what anyone
            # writes in that group, so the first person in does not become the
            # only one who can edit it.
            f"   valid users = {'@' + SMB_GROUP if shared else slug}",
        ]
        if shared:
            lines += [
                f"   force group = {SMB_GROUP}",
                "   create mask = 0660",
                "   directory mask = 2770",
            ]
        else:
            lines += [
                "   create mask = 0660",
                "   directory mask = 0770",
            ]
        lines.append("")
    return "\n".join(lines) + "\n"


def apply_smb_conf() -> None:
    # Called by every change to the spaces registry.
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


def smb_status() -> dict:
    """Samba's own view of who is connected, as JSON. {} when it cannot say.

    `smbstatus` only reports other people's sessions to root, and orion-api runs
    as root, so every session is visible. It also needs to write its messaging
    socket, which this service's read-only sandbox refuses (`Unable to initialize
    messaging context`), so the query runs the same way apt does: in a transient
    unit with the daemon's privileges and none of its sandbox. A host without
    Samba — or with the daemon stopped — answers nothing, which is a fact rather
    than an error.
    """
    if not samba_installed():
        return {}
    try:
        output = run_root("smbstatus --json", timeout=8)
    except (OSError, RuntimeError, subprocess.SubprocessError):
        return {}
    try:
        payload = json.loads(output or "{}")
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def parse_share_sessions(payload: dict) -> list[dict]:
    """One row per open tree connection: share, machine, and since when.

    Samba calls this section `shares` before 4.17 and `tcons` from 4.17, and has
    used both `machine` and `remote_machine` for the client. A build that renames
    a field again yields no rows rather than a made-up one.
    """
    rows = payload.get("tcons")
    if not isinstance(rows, (dict, list)):
        rows = payload.get("shares")
    if isinstance(rows, dict):
        rows = list(rows.values())
    found = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        service = str(row.get("service") or row.get("share") or "").strip()
        if not service or service.lower() == "ipc$":
            continue
        machine = str(
            row.get("machine") or row.get("remote_machine") or row.get("hostname") or ""
        ).strip()
        since = str(row.get("connected_at") or row.get("connectedAt") or "").strip()
        if since.isdigit():
            # Some builds report the connect time as epoch seconds.
            since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(int(since)))
        elif since:
            since = trim_fraction(since)
        found.append({"service": service, "machine": machine, "since": since})
    return found


def trim_fraction(value: str) -> str:
    """Six fractional digits are what Samba sends; Safari parses three at most."""
    match = re.match(
        r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$", value
    )
    if match is None:
        return value
    base, fraction, zone = match.groups()
    zone = "Z" if zone is None or zone in ("+00:00", "+0000", "-00:00", "-0000") else zone
    return f"{base}.{(fraction or '000')[:3]}{zone}"


def load_share_registry() -> dict:
    """The last machine on each share, and when each machine was first seen.

    `shares` is what the dialog shows. `machines` is what makes a connection an
    event: it remembers the first sighting rather than the current session, so a
    mount that has been open for a week does not notify again every poll.
    `labels` is what an admin called a machine, keyed by its address — the only
    name available for a client Samba can only report an address for.
    """
    empty = {"shares": {}, "machines": {}, "labels": {}}
    try:
        payload = json.loads(SHARE_CLIENTS.read_text())
    except (OSError, ValueError):
        return empty
    if not isinstance(payload, dict):
        return empty
    shares = payload.get("shares")
    machines = payload.get("machines")
    labels = payload.get("labels")
    return {
        "labels": {
            str(address): str(name).strip()
            for address, name in (labels if isinstance(labels, dict) else {}).items()
            if str(name or "").strip()
        },
        "shares": {
            str(key): value
            for key, value in (shares if isinstance(shares, dict) else {}).items()
            if isinstance(value, dict)
        },
        "machines": {
            str(slug): {
                str(machine): int(seen)
                for machine, seen in value.items()
                if str(machine).strip() and isinstance(seen, (int, float))
            }
            for slug, value in (machines if isinstance(machines, dict) else {}).items()
            if isinstance(value, dict)
        },
    }


def save_share_registry(registry: dict) -> None:
    META.mkdir(parents=True, exist_ok=True)
    temporary = SHARE_CLIENTS.with_name(SHARE_CLIENTS.name + ".tmp")
    temporary.write_text(json.dumps(registry, indent=2) + "\n")
    temporary.replace(SHARE_CLIENTS)


def forget_share_clients(slug: str) -> None:
    """Drop the remembered machines when a share or its person goes away."""
    registry = load_share_registry()
    forgotten = registry["shares"].pop(slug, None) is not None
    forgotten = registry["machines"].pop(slug, None) is not None or forgotten
    if not forgotten:
        return
    try:
        save_share_registry(registry)
    except OSError:
        # Nothing is claimed about a share that is gone either way.
        pass


CLIENT_CACHE: dict = {"at": 0.0, "key": None, "value": {}}


def share_client_map(spaces: list[dict], ttl: float = 5.0) -> dict[str, dict]:
    """Per-space connection facts: who is on the share now, and who was last.

    Cached for a few seconds because /api/state is polled and every space asks the
    same question of the same daemon. The remembered machine is only written
    when it changes, so a quiet host does not rewrite the registry on every read.
    """
    names = {str(space["slug"]): str(space.get("name") or space["slug"]) for space in spaces}
    key = tuple(sorted(names.items()))
    now = time.monotonic()
    if CLIENT_CACHE["key"] == key and now - float(CLIENT_CACHE["at"]) <= ttl:
        return CLIENT_CACHE["value"]
    # A share can be reached by its label (what Windows shows) or by the account
    # name Samba also accepts, so both map back to the space.
    by_share: dict[str, str] = {}
    for slug, name in names.items():
        by_share[samba_share_label(name).lower()] = slug
        by_share[slug.lower()] = slug
    registry = load_share_registry()
    remembered = registry["shares"]
    first_seen = registry["machines"]
    labels = registry["labels"]
    changed = False
    live: dict[str, list[dict]] = {}
    for session in parse_share_sessions(smb_status()):
        slug = by_share.get(session["service"].lower())
        if not slug:
            continue
        address = session["machine"]
        # What to call it: Samba only ever reports addresses, and an IPv6
        # link-local address is not a name anyone recognises.
        name = machine_name(address, labels) if address else ""
        live.setdefault(slug, []).append(
            {
                "machine": name or address,
                "address": address,
                "label": str(labels.get(address) or ""),
                "since": session["since"],
            }
        )
        machine = address
        if machine and machine not in first_seen.setdefault(slug, {}):
            # The moment this machine first appeared here, which is what makes a
            # connection a one-time event rather than a state to re-notify.
            first_seen[slug][machine] = int(time.time())
            changed = True
    for slug, clients in live.items():
        latest = max(clients, key=lambda client: client["since"] or "")
        if not latest["machine"]:
            continue
        record = {
            "machine": latest["machine"],
            "address": latest["address"],
            "label": latest["label"],
            "since": latest["since"],
        }
        if remembered.get(slug) != record:
            remembered[slug] = record
            changed = True
    if changed:
        try:
            save_share_registry(registry)
        except OSError:
            # The live answer is still true; only the memory of it is lost.
            pass
    value = {
        slug: {"clients": live.get(slug, []), "lastClient": remembered.get(slug)}
        for slug in names
    }
    CLIENT_CACHE.update(key=key, at=now, value=value)
    return value


# An address, as Samba reports it, plus the shape a label may be stored under:
# the registry key comes from a request, so it is checked rather than trusted.
CLIENT_ADDRESS = re.compile(r"^[A-Za-z0-9.:%_-]{1,64}$")
CLIENT_LABEL_MAX = 40


def can_label_client(address: str, session: dict) -> bool:
    """Admins name the machines on the shares they run; a platform admin, any."""
    permissions = session.get("permissions") or {}
    if not permissions.get("manageUsers"):
        return False
    if permissions.get("scope") == "all":
        return True
    agency = str(permissions.get("agency") or "")
    if not agency:
        return False
    spaces = load_spaces()
    clients = share_client_map(spaces)
    for space in spaces:
        if str(space.get("agency") or "") != agency:
            continue
        seen = clients.get(str(space["slug"])) or {}
        addresses = [client.get("address") for client in seen.get("clients") or []]
        addresses.append((seen.get("lastClient") or {}).get("address"))
        if address in addresses:
            return True
    return False


def set_share_client_label(address: str, name: str, session: dict) -> dict:
    """Remember what to call a client, or forget the name when it is empty.

    Samba only ever reports an address, and the resolver cannot name a machine
    that publishes nothing — an IPv6 client, typically. This is the escape
    hatch: an admin says "that is the kitchen tablet" once and every row, dialog
    and notice uses it from then on.
    """
    address = str(address or "").strip()
    if not CLIENT_ADDRESS.match(address):
        raise ValueError("invalid client address")
    label = " ".join(str(name or "").split())
    if len(label) > CLIENT_LABEL_MAX:
        raise ValueError(f"use {CLIENT_LABEL_MAX} characters or fewer")
    if not can_label_client(address, session):
        raise PermissionError("only an admin can name a client")
    registry = load_share_registry()
    labels = registry["labels"]
    if label:
        labels[address] = label
    else:
        labels.pop(address, None)
    # The last machine is a copy of its name, so it is rewritten here; otherwise
    # a share with no session open would keep the old name until somebody
    # connected again.
    for record in registry["shares"].values():
        if str(record.get("address") or "") == address:
            record["machine"] = label or machine_name(address, labels) or address
            record["label"] = label
    save_share_registry(registry)
    # The resolved name for this address may now be superseded, and the per-space
    # map was built from the old registry; neither may serve the next read.
    MACHINE_NAMES.pop(address, None)
    CLIENT_CACHE.update(key=None, at=0.0, value={})
    return {"address": address, "name": label or machine_name(address, labels) or address}


MACHINE_NAMES: dict[str, tuple[float, str]] = {}
MACHINE_NAME_TTL = 3600.0
# A name that did not answer once is asked again later, but not on every poll.
MACHINE_NAME_MISS_TTL = 600.0
# Names that are this server talking about itself. `nmblookup -A` answers for
# 0.0.0.0, for loopback and for the box's own address with its own aliases, and
# a share called "NAS" would be a confusing thing to call somebody's laptop.
OWN_NAMES = {
    NETBIOS_NAME.upper(),
    DISCOVERY_NAME.upper(),
    DISCOVERY_NAME.replace("-", "").upper(),
    "NAS",
    WORKGROUP.upper(),
}


def own_name(name: str) -> bool:
    """Is this one of the server's own names, or the LAN's browse master?"""
    upper = str(name or "").strip().upper()
    if not upper or upper == "__MSBROWSE__":
        return True
    # `ORION-NAS.LOCAL` is one of Samba's aliases, so compare the base name too.
    return upper in OWN_NAMES or upper.split(".")[0] in OWN_NAMES
# nmblookup waits ten seconds for a machine that does not answer, which is far
# too long for a request; two is enough on a LAN and the miss is cached anyway.
LOOKUP_TIMEOUT = 2


def netbios_name(address: str) -> str:
    """The Windows name a client answers to on its own link, or ''."""
    try:
        output = run_root(
            f"timeout {LOOKUP_TIMEOUT} nmblookup -A {shlex.quote(address)}", timeout=6
        )
    except (OSError, RuntimeError, subprocess.SubprocessError):
        return ""
    # nmblookup falls back to 0.0.0.0 for an address it cannot parse — including
    # every IPv6 one — and then cheerfully reports this server's own names. The
    # header is the only thing that says which machine was actually asked.
    if f"Looking up status of {address}" not in output:
        return ""
    for line in output.splitlines():
        fields = line.split()
        if len(fields) < 2 or fields[1] != "<00>" or "<GROUP>" in fields:
            continue
        name = fields[0].strip().rstrip("$")
        if own_name(name):
            continue
        return name
    return ""


def resolver_name(address: str) -> str:
    """Whatever the host's resolver knows this address as, or ''.

    `getent` is the system resolver, so this covers DNS, /etc/hosts and mDNS when
    avahi's NSS module is installed — the paths a NetBIOS lookup cannot reach.
    """
    try:
        output = run_root(
            f"timeout {LOOKUP_TIMEOUT} getent hosts {shlex.quote(address)}", timeout=6
        )
    except (OSError, RuntimeError, subprocess.SubprocessError):
        return ""
    for line in output.splitlines():
        fields = line.split()
        if len(fields) < 2:
            continue
        name = fields[1].rstrip(".")
        if not name or name == address or name.split(".")[0].lower() == "localhost":
            continue
        if own_name(name):
            continue
        return name
    return ""


def client_label(address: str) -> str:
    """The name an admin gave this address, or ''.

    Asked per address rather than through machine_name because the answer is a
    decision, not a lookup: it must not be aged out by the resolver's cache.
    """
    address = str(address or "").strip()
    if not address:
        return ""
    return str(load_share_registry()["labels"].get(address) or "")


def machine_name(address: str, labels: dict | None = None) -> str:
    """A name for a client's address, or '' when nothing here knows one.

    NetBIOS first, because that is the name Windows puts on the wire; then the
    system resolver. Both are shelled out with a timeout through the unsandboxed
    path smbstatus needs, so a slow lookup can never hold up /api/state, and the
    answer is cached: names rarely change, and asking again every twenty seconds
    would turn a nicety into load.
    """
    address = str(address or "").strip()
    if not address:
        return ""
    # An admin's own name for the machine comes first: it was given because the
    # lookup either cannot answer (an IPv6 client) or answers unhelpfully.
    if labels is None:
        labels = load_share_registry()["labels"]
    chosen = str(labels.get(address) or "").strip()
    if chosen:
        return chosen
    cached = MACHINE_NAMES.get(address)
    now = time.monotonic()
    if cached is not None and now < cached[0]:
        return cached[1]
    bare = address.split("%", 1)[0]
    name = ""
    # NetBIOS is IPv4-only; asking it about an IPv6 address gets a wrong answer
    # before it gets no answer.
    if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", bare):
        name = netbios_name(bare)
    if not name:
        name = resolver_name(bare)
    ttl = MACHINE_NAME_TTL if name else MACHINE_NAME_MISS_TTL
    MACHINE_NAMES[address] = (now + ttl, name)
    return name


SHARE_NOTICE_WINDOW = 24 * 3600


def human_ago(seconds: float) -> str:
    minutes = int(seconds // 60)
    if minutes < 1:
        return "just now"
    if minutes < 60:
        return f"{minutes} min ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} hr ago"
    return f"{hours // 24} days ago"


def share_notices(limit: int = 3) -> list[dict]:
    """Machines that appeared on a share for the first time in the last day.

    The registry keeps the first sighting per machine per share, so this fires
    once when something new mounts and then goes quiet: a session left open for
    a week is not news, and the same machine reconnecting is not either. It
    expires on its own after a day rather than being dismissed by hand.
    """
    registry = load_share_registry()
    labels = registry["labels"]
    names = {str(space["slug"]): str(space.get("name") or space["slug"]) for space in load_spaces()}
    now = time.time()
    found: list[tuple[float, dict]] = []
    for slug, machines in registry["machines"].items():
        share_name = names.get(slug)
        if share_name is None:
            # The share is gone; nothing left to notify about.
            continue
        for machine, first_seen in machines.items():
            age = now - first_seen
            if age < 0 or age > SHARE_NOTICE_WINDOW:
                continue
            name = machine_name(machine, labels) or machine
            handle = re.sub(r"[^a-z0-9]+", "-", machine.lower()).strip("-") or "client"
            found.append(
                (
                    age,
                    {
                        "id": f"n-share-{slug}-{handle}",
                        "title": f"{name} connected to {share_name}",
                        "body": (
                            f"First seen {human_ago(age)} on \\{NETBIOS_NAME}\\{slug}"
                            + (f" ({machine})" if name != machine else "")
                            + ". New connections are remembered once."
                        ),
                        "tone": "success",
                        "time": human_ago(age),
                        "read": False,
                        "action": {
                            "label": "Open the share",
                            "route": "files",
                            "path": f"/{USERS_DIR_NAME}/{slug}",
                        },
                    },
                )
            )
    found.sort(key=lambda entry: entry[0])
    return [item for _, item in found[:limit]]


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


def render_wsdd_unit() -> str:
    """Announce SMB to Windows, under the name the shares answer to.

    Windows 10/11 no longer browse NetBIOS, so nmbd alone does not put a server
    in Explorer's Network view; WS-Discovery does. The daemon only makes sense
    while Samba is running, so the unit follows it.
    """
    return (
        "[Unit]\n"
        "Description=Web Service Discovery host daemon (Windows network browsing)\n"
        "Documentation=man:wsdd(1)\n"
        "After=network-online.target smbd.service\n"
        "Wants=network-online.target\n"
        "ConditionPathExists=/etc/samba/smb.conf\n"
        "\n"
        "[Service]\n"
        "Type=simple\n"
        f"ExecStart=/usr/bin/wsdd --hostname {NETBIOS_NAME} --workgroup {WORKGROUP} --ipv4only\n"
        "Restart=on-failure\n"
        "RestartSec=3\n"
        "\n"
        "[Install]\n"
        "WantedBy=multi-user.target\n"
    )


def apply_wsd() -> None:
    """Write and start the wsdd unit Orion manages."""
    if not which("wsdd"):
        return
    unit = render_wsdd_unit()
    run_root(
        "set -e\n"
        f"cat > {WSDD_UNIT}\n"
        "systemctl daemon-reload\n"
        "systemctl enable wsdd.service >/dev/null 2>&1 || true\n"
        "systemctl restart wsdd.service\n",
        stdin_text=unit,
        timeout=120,
    )


def which(binary: str) -> bool:
    return any((Path(directory) / binary).exists() for directory in os.environ.get(
        "PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    ).split(":"))


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


HEALTH_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orion NAS · status</title>
<style>
  :root {
    --bg: #07080c; --surface: #0d1016; --line: #1b2030;
    --text: #e8ecf5; --muted: #8b93a7; --accent: #0a63ff;
    --ok: #22c55e; --warn: #f59e0b; --bad: #ef4444;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 24px; background: var(--bg); color: var(--text);
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 880px; margin: 0 auto; }
  .top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .mark {
    width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center;
    background: linear-gradient(150deg, #12327d, #0a63ff); font-weight: 700; letter-spacing: .02em;
  }
  h1 { font-size: 19px; margin: 0; font-weight: 650; letter-spacing: -.01em; }
  .sub { color: var(--muted); font-size: 12.5px; }
  .pill {
    margin-left: auto; display: inline-flex; align-items: center; gap: 8px;
    padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 600;
    border: 1px solid var(--line); background: var(--surface);
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); }
  .pill.ok { color: #b9f6ce; border-color: #14532d; background: #08210f; }
  .pill.ok .dot { background: var(--ok); box-shadow: 0 0 0 4px rgba(34,197,94,.16); animation: pulse 2.4s ease-in-out infinite; }
  .pill.bad { color: #fecaca; border-color: #7f1d1d; background: #240b0b; }
  .pill.bad .dot { background: var(--bad); box-shadow: 0 0 0 4px rgba(239,68,68,.16); }
  @keyframes pulse { 50% { box-shadow: 0 0 0 7px rgba(34,197,94,.05); } }
  .meta { display: flex; gap: 18px; flex-wrap: wrap; margin: 18px 0 26px; color: var(--muted); font-size: 12.5px; }
  .meta b { color: var(--text); font-weight: 600; }
  .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .card {
    background: var(--surface); border: 1px solid var(--line); border-radius: 14px;
    padding: 16px 18px; min-width: 0;
  }
  .card h2 { margin: 0 0 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .09em; color: var(--muted); font-weight: 650; }
  .value { font-size: 27px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .value small { font-size: 13px; color: var(--muted); font-weight: 500; margin-left: 4px; }
  .spark { display: block; width: 100%; height: 38px; margin-top: 10px; }
  .spark polyline { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .spark .area { fill: rgba(10, 99, 255, .16); stroke: none; }
  section.block { margin-top: 14px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  li { display: flex; align-items: center; gap: 10px; font-size: 13.5px; }
  li .dot { flex: none; }
  li .name { font-weight: 600; min-width: 78px; }
  li .why { color: var(--muted); font-size: 12.5px; }
  li .state { margin-left: auto; color: var(--muted); font-size: 12.5px; white-space: nowrap; }
  .bar { height: 7px; border-radius: 999px; background: #161b26; overflow: hidden; margin-top: 9px; }
  .bar span { display: block; height: 100%; background: linear-gradient(90deg, #1d7bff, #6ea8ff); }
  .pool { display: grid; gap: 4px; }
  .pool .row { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
  .pool .row span:last-child { color: var(--muted); font-variant-numeric: tabular-nums; }
  footer { margin-top: 26px; color: var(--muted); font-size: 12.5px; display: flex; gap: 12px; flex-wrap: wrap; }
  footer a { color: #9dc0ff; text-decoration: none; }
  footer a:hover { text-decoration: underline; }
  @media (prefers-reduced-motion: reduce) { .pill.ok .dot { animation: none; } }
</style>
</head>
<body>
<main>
  <div class="top">
    <span class="mark" aria-hidden="true">O</span>
    <div>
      <h1>Orion NAS</h1>
      <div class="sub" id="host">reading this machine…</div>
    </div>
    <span class="pill" id="status" role="status"><span class="dot"></span><span id="status-text">checking</span></span>
  </div>

  <div class="meta">
    <span>build <b id="version">—</b></span>
    <span>up <b id="uptime">—</b></span>
    <span>checked <b id="checked">—</b></span>
  </div>

  <div class="grid">
    <article class="card">
      <h2>CPU</h2>
      <div class="value"><span id="cpu">—</span><small>%</small></div>
      <svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
        <polygon class="area" id="cpu-area" points="" />
        <polyline id="cpu-line" points="" />
      </svg>
    </article>
    <article class="card">
      <h2>Memory</h2>
      <div class="value"><span id="ram">—</span><small>%</small></div>
      <svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
        <polygon class="area" id="ram-area" points="" />
        <polyline id="ram-line" points="" />
      </svg>
    </article>
    <article class="card">
      <h2>Network</h2>
      <div class="value"><span id="net">—</span><small id="net-unit">B/s</small></div>
      <div class="sub" style="margin-top:6px"><span id="net-detail">down — · up —</span></div>
    </article>
  </div>

  <section class="block card">
    <h2>Services</h2>
    <ul id="checks"></ul>
  </section>

  <section class="block card">
    <h2>Storage</h2>
    <ul id="storage"></ul>
  </section>

  <footer>
    <span>Refreshes every 5 seconds.</span>
    <a href="/app/">Open the desktop</a>
  </footer>
</main>

<script>
const data = __DATA__;

const el = (id) => document.getElementById(id);

function uptime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days) return days + 'd ' + hours + 'h';
  if (hours) return hours + 'h ' + minutes + 'm';
  return minutes + 'm ' + (s % 60) + 's';
}

function rate(bytes) {
  const value = Math.max(0, bytes || 0);
  if (value > 1048576) return [ (value / 1048576).toFixed(1), 'MB/s' ];
  if (value > 1024) return [ (value / 1024).toFixed(1), 'KB/s' ];
  return [ value.toFixed(0), 'B/s' ];
}

function spark(lineId, areaId, history) {
  const values = (history || []).slice(-60);
  const line = el(lineId);
  const area = el(areaId);
  if (!line) return;
  if (values.length < 2) { line.setAttribute('points', ''); if (area) area.setAttribute('points', ''); return; }
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 30 - (Math.max(0, Math.min(100, value)) / 100) * 28 - 1;
    return x.toFixed(2) + ',' + y.toFixed(2);
  });
  line.setAttribute('points', points.join(' '));
  if (area) area.setAttribute('points', '0,30 ' + points.join(' ') + ' 100,30');
}

function render(facts) {
  const ok = facts.status === 'operational';
  const pill = el('status');
  pill.className = 'pill ' + (ok ? 'ok' : 'bad');
  el('status-text').textContent = ok ? 'Operational' : 'Degraded';
  el('host').textContent = (facts.hostname || 'this host') + ' · ' + (facts.runtime || '');
  el('version').textContent = (facts.version && (facts.version.version + ' · ' + facts.version.build)) || 'dev';
  el('uptime').textContent = uptime(facts.uptimeSeconds);
  el('checked').textContent = new Date(facts.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const metrics = facts.metrics || {};
  el('cpu').textContent = metrics.cpu ?? '—';
  el('ram').textContent = metrics.ram ?? '—';
  const [down, downUnit] = rate(metrics.netDown);
  el('net').textContent = down;
  el('net-unit').textContent = downUnit;
  const [up, upUnit] = rate(metrics.netUp);
  el('net-detail').textContent = 'down ' + down + ' ' + downUnit + ' · up ' + up + ' ' + upUnit;
  spark('cpu-line', 'cpu-area', metrics.cpuHistory);
  spark('ram-line', 'ram-area', metrics.ramHistory);

  el('checks').innerHTML = (facts.checks || []).map((check) => {
    const color = !check.installed ? 'var(--muted)' : (check.ok ? 'var(--ok)' : 'var(--bad)');
    return '<li><span class="dot" style="background:' + color + '"></span>' +
      '<span class="name">' + check.label + '</span>' +
      '<span class="why">' + check.purpose + '</span>' +
      '<span class="state">' + check.state + '</span></li>';
  }).join('');

  const pools = (facts.storage && facts.storage.pools) || [];
  el('storage').innerHTML = pools.map((pool) => {
    const used = pool.usedBytes || 0;
    const total = pool.totalBytes || 1;
    const percent = Math.min(100, Math.round((used / total) * 100));
    return '<li style="display:block">' +
      '<div class="pool"><div class="row"><span><b>' + pool.name + '</b> <span class="dim">' + pool.source + '</span></span>' +
      '<span>' + percent + '% of ' + fmt(total) + '</span></div>' +
      '<div class="bar"><span style="width:' + percent + '%"></span></div></div></li>';
  }).join('') || '<li><span class="why">No pools reported.</span></li>';
}

function fmt(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return value.toFixed(value >= 10 || index === 0 ? 0 : 1) + ' ' + units[index];
}

render(data);
setInterval(async () => {
  try {
    const response = await fetch('/health?format=json', { cache: 'no-store' });
    render(await response.json());
  } catch (error) {
    el('status').className = 'pill bad';
    el('status-text').textContent = 'API unreachable';
  }
}, 5000);
</script>
</body>
</html>
"""


HEALTH_UNITS = (
    ("orion-api.service", "API", "the JSON surface this page is drawn from"),
    ("nginx.service", "nginx", "serves the desktop and proxies the API"),
    ("smbd.service", "SMB", "the share every space is mounted from"),
    ("nmbd.service", "NetBIOS", "answers to ORION-NAS on the LAN"),
    ("avahi-daemon.service", "mDNS", "publishes orion-nas.local"),
)
HEALTH_PACKAGES = {
    "smbd.service": "samba",
    "nmbd.service": "samba",
    "avahi-daemon.service": "avahi-daemon",
    "nginx.service": "nginx",
}
HEALTH_CORE = {"orion-api.service", "nginx.service"}


def health_facts() -> dict:
    """What is true right now, shaped for a status page and a probe alike."""
    storage = storage_facts()
    metrics = SAMPLER.snapshot()
    checks = []
    degraded = False
    for unit, label, purpose in HEALTH_UNITS:
        package = HEALTH_PACKAGES.get(unit)
        installed = True if package is None else dpkg_installed(package)
        if not installed:
            checks.append(
                {"id": unit, "label": label, "purpose": purpose, "installed": False,
                 "state": "not installed", "ok": True}
            )
            continue
        ok, state = unit_state(unit)
        if not ok and unit in HEALTH_CORE:
            degraded = True
        checks.append(
            {"id": unit, "label": label, "purpose": purpose, "installed": True,
             "state": state, "ok": ok}
        )
    pools = storage.get("pools") or []
    storage_ok = bool(pools) and all(pool.get("totalBytes") for pool in pools)
    if not storage_ok:
        degraded = True
    return {
        "status": "degraded" if degraded else "operational",
        "ok": not degraded,
        "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "hostname": socket.gethostname(),
        "runtime": container_runtime(),
        "version": version_facts(),
        "uptimeSeconds": metrics["uptimeSeconds"],
        "checks": checks,
        "storage": storage,
        "metrics": metrics,
    }


def render_health_page(facts: dict) -> str:
    payload = json.dumps(facts).replace("</", "<\\/")
    return (
        HEALTH_PAGE.replace("__DATA__", payload)
    )


def notifications_facts(storage: dict, services: list[dict]) -> list[dict]:
    # A machine arriving on a share is the one notice that comes from something
    # happening rather than from a threshold, so it leads the list.
    items = share_notices()
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
    trashed = trash_count()
    if trashed:
        items.append(
            {
                "id": "n-trash",
                "title": f"{trashed} item{'s' if trashed != 1 else ''} in Trash",
                "body": "They stay on disk until you empty Trash in Files, so anything can be put back.",
                "tone": "info",
                "time": "now",
                "read": True,
                "action": {"label": "Open Trash", "route": "files", "trash": True},
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

    def page(self, body: str, status: int = 200) -> None:
        payload = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def fail(self, message: str, status: int = 400) -> None:
        self.json({"error": message}, status)

    def identity(self) -> dict | None:
        """Who the edge says is signed in, or None.

        Two header families are accepted because the two ways of putting
        oauth2-proxy in front of a service send different ones:

        * `X-Forwarded-*` is what the proxy adds to the *upstream request* —
          its `--pass-user-headers` flag. This is the path the estate uses.
        * `X-Auth-Request-*` is only ever a *response* header, from
          `--set-xauthrequest`, for nginx's auth_request mode. Kept because
          other deployments front this app that way.

        Reading only the second family is how the desktop spent a release
        believing nobody was signed in while the proxy had the address.
        """

        def header(*names: str) -> str:
            for name in names:
                value = (self.headers.get(name) or "").strip()
                if value:
                    return value
            return ""

        email = header("X-Auth-Request-Email", "X-Forwarded-Email", "X-Authentik-Email")
        if not email:
            return None
        username = header("X-Auth-Request-User", "X-Forwarded-User")
        # An OIDC provider whose subject is hashed sends that hash in the user
        # header. It identifies nobody in a way a person can read, so it is not
        # kept as the account name; the address is the honest fallback there.
        if len(username) == 64 and all(c in "0123456789abcdef" for c in username):
            username = ""
        preferred = header(
            "X-Auth-Request-Preferred-Username", "X-Forwarded-Preferred-Username"
        )
        # preferred_username carries the person's display name when the provider
        # is configured to send one (see deploy/sso/provision-authentik.py), and
        # the bare handle otherwise. A name is already written the way its owner
        # writes it; a handle is not, so only a single-word value is title-cased:
        # dhunter -> Dhunter, d.hunter -> D Hunter, David Hunter -> unchanged.
        handle = preferred or username or email.split("@")[0]
        if " " in handle:
            display = handle
        else:
            words = [part for part in re.split(r"[._\-]+", handle) if part]
            display = " ".join(word.capitalize() for word in words) or handle
        groups: list[str] = []
        for value in header("X-Auth-Request-Groups", "X-Forwarded-Groups").split(","):
            group = value.strip()
            # A directory that lists a group twice (directly and through a
            # parent) must not make the app claim the person is in it twice.
            if group and group not in groups:
                groups.append(group)
        return {"email": email, "name": display, "username": username, "groups": groups}

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
            if route in ("/health", "/api/health"):
                facts = health_facts()
                status = HTTPStatus.OK if facts["ok"] else HTTPStatus.SERVICE_UNAVAILABLE
                # /health is the one path the edge proxy leaves open, so the
                # page has to be able to refresh itself through it: ?format=json
                # is the same data the page was drawn from.
                wants_json = route == "/api/health" or self.query().get("format") == "json"
                if wants_json:
                    self.json(facts, status)
                else:
                    self.page(render_health_page(facts), status)
                return
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
                identity = self.identity()
                session = session_facts(identity)
                self.json(
                    {
                        "files": nodes,
                        "storage": storage,
                        "session": session,
                        "signin": {
                            "available": directory_ready(),
                            "group": directory_settings()["group"],
                        },
                        "users": users_facts(identity, session),
                        "spaces": spaces_facts(session),
                        "apps": apps_facts(),
                        "services": services,
                        "notifications": notifications_facts(storage, services),
                        "roots": [
                            {"label": node["name"], "path": node["id"]}
                            for node in sorted(nodes, key=lambda item: item["name"].lower())
                            if node["parent"] == "/" and node["type"] == "folder"
                        ],
                        "trash": {"count": trash_count()},
                    }
                )
                return
            if route == "/api/files/content":
                self.download()
                return
            if route == "/api/trash":
                self.json(trash_facts())
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
            if route == "/api/trash/restore":
                payload = self.body()
                restored = restore_from_trash(str(payload.get("name") or ""))
                self.json({"ok": True, **restored})
                return
            if route == "/api/users":
                session = session_facts(self.identity())
                space = create_space(self.body(), session)
                self.json({"ok": True, "space": space}, HTTPStatus.CREATED)
                return
            if route.startswith("/api/users/") and route.endswith("/password"):
                slug = urllib.parse.unquote(route[len("/api/users/") :].removesuffix("/password"))
                payload = self.body()
                session = session_facts(self.identity())
                space = set_space_password(slug, str(payload.get("password") or ""), session)
                self.json({"ok": True, "space": space})
                return
            if route == "/api/me/space":
                identity = self.identity()
                session = session_facts(identity)
                space = create_own_space(identity, self.body(), session)
                self.json({"ok": True, "space": space}, HTTPStatus.CREATED)
                return
            if route == "/api/me/password":
                changed = change_own_password(self.identity(), str(self.body().get("password") or ""))
                self.json({"ok": True, **changed})
                return
            if route.startswith("/api/users/") and route.endswith("/role"):
                slug = urllib.parse.unquote(route[len("/api/users/") :].removesuffix("/role"))
                payload = self.body()
                session = session_facts(self.identity())
                space = set_space_role(slug, payload.get("role"), session)
                self.json({"ok": True, "space": space})
                return
            if route.startswith("/api/users/") and route.endswith("/shared"):
                slug = urllib.parse.unquote(route[len("/api/users/") :].removesuffix("/shared"))
                payload = self.body()
                session = session_facts(self.identity())
                space = set_space_shared(slug, bool(payload.get("shared")), session)
                self.json({"ok": True, "space": space})
                return
            if route.startswith("/api/users/") and route.endswith("/email"):
                slug = urllib.parse.unquote(route[len("/api/users/") :].removesuffix("/email"))
                payload = self.body()
                session = session_facts(self.identity())
                space = set_space_email(slug, str(payload.get("email") or ""), session)
                self.json({"ok": True, "space": space})
                return
            if route == "/api/share-clients":
                payload = self.body()
                session = session_facts(self.identity())
                named = set_share_client_label(
                    str(payload.get("address") or ""), str(payload.get("name") or ""), session
                )
                self.json({"ok": True, **named})
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
        except PermissionError as error:
            self.fail(str(error), HTTPStatus.FORBIDDEN)
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
            if route == "/api/trash":
                removed = empty_trash()
                self.json({"ok": True, "removed": removed})
                return
            if route.startswith("/api/users/") and route.endswith("/share"):
                slug = urllib.parse.unquote(route[len("/api/users/") :].removesuffix("/share"))
                session = session_facts(self.identity())
                space = remove_share(slug, session)
                self.json({"ok": True, "space": space})
                return
            if route.startswith("/api/users/"):
                slug = urllib.parse.unquote(route[len("/api/users/") :])
                session = session_facts(self.identity())
                space = delete_space(slug, session)
                self.json({"ok": True, "slug": space["slug"], "name": space["name"]})
                return
            self.fail("not found", HTTPStatus.NOT_FOUND)
        except PermissionError as error:
            self.fail(str(error), HTTPStatus.FORBIDDEN)
        except LookupError as error:
            self.fail(str(error), HTTPStatus.NOT_FOUND)
        except ValueError as error:
            self.fail(str(error))
        except RuntimeError as error:
            self.fail(str(error), HTTPStatus.BAD_GATEWAY)
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
