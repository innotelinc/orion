#!/usr/bin/env python3
"""Point nas.innotel.us at Orion's sign-in proxy, keeping its certificate.

Before this runs, NPM forwards straight to 192.168.1.89:80 and anyone on the
LAN could read the desktop. After it, the only upstream is oauth2-proxy on
192.168.1.71:14016, and the container itself refuses every other source.

    python3 point-npm.py            # apply
    DRY_RUN=1 python3 point-npm.py  # print the change only
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

ENV = "/usr/src/projects/complete/1-primary/cerulean/.env"
HOST = "nas.innotel.us"
UPSTREAM = ("192.168.1.71", 14016)
DRY = "DRY_RUN=1" in os.environ

# oauth2-proxy answers /oauth2/callback with a Set-Cookie holding the whole
# encrypted session — id_token, groups and all — which is several kilobytes.
# nginx's default 4k proxy_buffer_size rejects the header and NPM returns a 502
# *after* the sign-in succeeded, so the browser sees a failed login and the
# proxy log shows a 302. These belong to this host; keep them out of nginx's
# global config so no other vhost inherits them.
ADVANCED_CONFIG = """# oauth2-proxy session cookie: the callback's Set-Cookie is several kilobytes
proxy_buffer_size 16k;
proxy_buffers 4 16k;"""

env = {}
for line in open(ENV):
    match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line.rstrip("\n"))
    if match:
        env[match.group(1)] = match.group(2).strip().strip('"').strip("'")

npm = env.get("NPM_PUBLIC_API_URL", "http://127.0.0.1:81").rstrip("/")


def call(path, method="GET", body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(npm + path, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode()
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{method} {path} -> HTTP {error.code}: {error.read().decode()[:300]}")


token = call(
    "/api/tokens", "POST", {"identity": env["NPM_ADMIN_EMAIL"], "secret": env["NPM_ADMIN_PASSWORD"]}
)["token"]
auth = {"Authorization": "Bearer " + token}

hosts = call("/api/nginx/proxy-hosts", headers=auth)
host = next((item for item in hosts if HOST in (item.get("domain_names") or [])), None)
if not host:
    raise SystemExit(f"NPM has no proxy host for {HOST}")

print(
    f"before: {HOST} -> {host['forward_scheme']}://{host['forward_host']}:{host['forward_port']} "
    f"cert={host.get('certificate_id')} ssl={host.get('ssl_forced')}"
)

body = {
    "domain_names": host["domain_names"],
    "forward_scheme": "http",
    "forward_host": UPSTREAM[0],
    "forward_port": UPSTREAM[1],
    "access_list_id": host.get("access_list_id", 0),
    "advanced_config": (
        ADVANCED_CONFIG
        if "proxy_buffer_size" in (host.get("advanced_config") or "")
        else f"{ADVANCED_CONFIG}\n\n{host.get('advanced_config') or ''}".rstrip() + "\n"
    ),
    "block_exploits": host.get("block_exploits", True),
    "caching_enabled": False,
    "allow_websocket_upgrade": host.get("allow_websocket_upgrade", True),
    "http2_support": host.get("http2_support", True),
    "hsts_enabled": host.get("hsts_enabled", False),
    "hsts_subdomains": False,
    "ssl_forced": True,
    "certificate_id": host.get("certificate_id"),
    "meta": host.get("meta", {"letsencrypt_agree": False, "dns_challenge": False}),
    "locations": host.get("locations", []),
    "enabled": True,
}

if DRY:
    print(f"would set upstream {UPSTREAM[0]}:{UPSTREAM[1]}, cert {body['certificate_id']}")
    print("advanced_config would be:")
    print(body["advanced_config"])
    sys.exit(0)

updated = call(f"/api/nginx/proxy-hosts/{host['id']}", "PUT", body, auth)
print(
    f"after:  {HOST} -> {updated['forward_scheme']}://{updated['forward_host']}:"
    f"{updated['forward_port']} cert={updated.get('certificate_id')} "
    f"ssl={updated.get('ssl_forced')} enabled={updated.get('enabled')}"
)
