#!/usr/bin/env python3
"""Who can administer this estate, and who has more than they need?

Read-only. Lists superusers (flag or superuser group), dormant privileged
accounts, service accounts and the widest group memberships.
"""

import json
import re
import urllib.request

ENV = "/usr/src/projects/complete/1-primary/cerulean/.env"

env = {}
for line in open(ENV):
    match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line.rstrip("\n"))
    if match:
        env[match.group(1)] = match.group(2).strip().strip('"').strip("'")

API = env["AUTHENTIK_API_URL"].rstrip("/")
if not API.endswith("/api/v3"):
    API += "/api/v3"
TOKEN = env["AUTHENTIK_BOOTSTRAP_TOKEN"]


def call(path):
    request = urllib.request.Request(API + path)
    request.add_header("Authorization", "Bearer " + TOKEN)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode())


def pages(path):
    page = 1
    while True:
        payload = call(f"{path}{'&' if '?' in path else '?'}page={page}&page_size=200")
        yield from payload["results"]
        if not payload["pagination"].get("next"):
            return
        page += 1


users = list(pages("/core/users/"))
groups = list(pages("/core/groups/"))
super_groups = {group["name"] for group in groups if group.get("is_superuser")}


def is_super(user):
    return bool(user.get("is_superuser")) or any(
        group.get("is_superuser") for group in user.get("groups_obj") or []
    )


def admin_groups(user):
    return [
        group["name"]
        for group in user.get("groups_obj") or []
        if group.get("is_superuser") or "admin" in group["name"].lower()
    ]


def dormant(user):
    return not user.get("last_login")


superusers = [user for user in users if is_super(user)]
print(f"users={len(users)} groups={len(groups)} superuser-groups={sorted(super_groups)}")
print(f"superusers={len(superusers)}")
print()

print("Superuser accounts")
for user in sorted(superusers, key=lambda item: item["username"]):
    login = (user.get("last_login") or "never")[:10]
    print(
        f"  {user['username']:12} type={user.get('type','-'):16} "
        f"active={str(user.get('is_active')):5} last={login:10} "
        f"groups={len(user.get('groups') or [])} flag={user.get('is_superuser')}"
    )

print()
print("Privileged but dormant or disabled")
flagged = False
for user in superusers:
    if dormant(user) or not user.get("is_active"):
        flagged = True
        print(
            f"  {user['username']:12} last={user.get('last_login')} "
            f"active={user.get('is_active')}"
        )
if not flagged:
    print("  none")

print()
print("Non-human accounts with admin rights")
flagged = False
for user in users:
    # Authentik's normal logins are type "internal"; outpost and client
    # credentials are service accounts and must not carry admin groups.
    if user.get("type") != "internal" and (is_super(user) or admin_groups(user)):
        flagged = True
        print(
            f"  {user['username']:44} type={user.get('type')} "
            f"admin-groups={admin_groups(user)}"
        )
if not flagged:
    print("  none — every account with admin rights is a normal login")

print()
print("Broadest memberships")
for user in sorted(users, key=lambda item: len(item.get("groups") or []), reverse=True)[:8]:
    total = len(user.get("groups") or [])
    print(f"  {user['username']:12} {total:2} groups · admin-ish: {', '.join(admin_groups(user)) or '—'}")

print()
print("Cross-tenant administrators (2+ admin groups, not superuser)")
flagged = False
for user in users:
    if is_super(user):
        continue
    admins = admin_groups(user)
    if len(admins) >= 2:
        flagged = True
        print(f"  {user['username']:12} {admins}")
if not flagged:
    print("  none")
