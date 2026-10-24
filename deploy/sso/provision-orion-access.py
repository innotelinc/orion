#!/usr/bin/env python3
"""Give Orion the least it needs to create sign-ins (runs on the edge host).

Adding a person in Settings → Users creates their folder, their share and — if
this has been run — their account in Authentik, in one group the edge proxy
lets through. That needs a directory credential, and it must not be the
bootstrap token or an administrator's login: this script mints a service account
whose role holds exactly the six permissions provisioning uses, proves the
credential can do that and nothing else it should not, and writes it to the
Cerulean vault rather than to a file next to the compose project.

    python3 provision-orion-access.py

Idempotent: the group, role, service account and token are reused, and only a
missing token is minted. The token is written once — Vault is the place to read
it from, never this script's output.
"""

import json
import os
import re
import secrets
import urllib.error
import urllib.request

CERULEAN_ENV = "/usr/src/projects/complete/1-primary/cerulean/.env"
VAULT_INIT = "/usr/src/projects/complete/1-primary/cerulean/data/vault/init/init.json"
VAULT_ADDR = "http://127.0.0.1:8200"
VAULT_PATH = "cerulean/data/orion"

GROUP = "orion-users"
ROLE = "orion-provisioner"
SERVICE_ACCOUNT = "orion-provisioner"
TOKEN_IDENTIFIER = "orion-provisioner"

# What creating one person actually touches: the user, its password, and the
# group it is born in. Deliberately absent: change_user (it can set is_superuser
# on the service account — checked, it worked) and add_group (the access group
# is made here, once, by this script). Deleting rather than deactivating is the
# price of dropping change_user, so removal ends the sign-in for good.
PERMISSIONS = [
    "add_user",
    "view_user",
    "delete_user",
    "view_group",
    "add_user_to_group",
    "reset_user_password",
]
# What this script granted before it knew better. change_user is the dangerous
# one: it makes the service account a superuser with a single PATCH.
RETIRED = ["change_user", "change_group", "add_group"]

env = {}
for line in open(CERULEAN_ENV, encoding="utf-8"):
    match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line.rstrip("\n"))
    if match:
        env[match.group(1)] = match.group(2).strip().strip('"').strip("'")

API = env["AUTHENTIK_API_URL"].rstrip("/")
if not API.endswith("/api/v3"):
    API += "/api/v3"
ADMIN_TOKEN = env["AUTHENTIK_BOOTSTRAP_TOKEN"]


def call(path, method="GET", body=None, token=ADMIN_TOKEN):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(API + path, data=data, method=method)
    request.add_header("Authorization", "Bearer " + token)
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode()
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{method} {path} -> HTTP {error.code}: {error.read().decode()[:300]}")


def ensure_group():
    found = call(f"/core/groups/?name={GROUP}")
    for group in found.get("results") or []:
        if group["name"] == GROUP:
            print(f"group exists: {GROUP} pk={group['pk']}")
            return group
    group = call("/core/groups/", "POST", {"name": GROUP, "is_superuser": False})
    print(f"group created: {GROUP} pk={group['pk']}")
    return group


def ensure_role():
    for role in call("/rbac/roles/?page_size=200")["results"]:
        if role["name"] == ROLE:
            print(f"role exists: {ROLE} pk={role['pk']}")
            return role
    role = call("/rbac/roles/", "POST", {"name": ROLE})
    print(f"role created: {ROLE} pk={role['pk']}")
    return role


def desired_permission_ids():
    wanted = set()
    page = 1
    while True:
        payload = call(f"/rbac/permissions/?page_size=200&page={page}")
        for permission in payload["results"]:
            if permission["app_label"] == "authentik_core" and permission["codename"] in PERMISSIONS:
                wanted.add((permission["codename"], permission["id"]))
        if not payload["pagination"]["next"]:
            break
        page += 1
    missing = set(PERMISSIONS) - {codename for codename, _ in wanted}
    if missing:
        raise SystemExit(f"these permissions do not exist on this provider: {sorted(missing)}")
    return wanted


def assign_permissions(role):
    # Authentik exposes no read of a role's grants (assigned_by_roles only
    # writes), and re-sending a grant is a no-op, so the desired set is simply
    # asserted on every run. Permissions earlier versions of this script needed
    # are withdrawn explicitly, because a wider role must not survive an edit to
    # the list above: change_user let the token make itself a superuser.
    desired_permission_ids()  # fail early if the provider lacks one of them
    call(
        f"/rbac/permissions/assigned_by_roles/{role['pk']}/assign/",
        "POST",
        # A global grant is named app_label.codename; numeric ids only address
        # object-scoped permissions.
        {"permissions": [f"authentik_core.{codename}" for codename in PERMISSIONS]},
    )
    call(
        f"/rbac/permissions/assigned_by_roles/{role['pk']}/unassign/",
        "PATCH",
        {"permissions": [f"authentik_core.{codename}" for codename in RETIRED]},
    )
    print(f"permissions asserted: {sorted(PERMISSIONS)} (withdrew {sorted(RETIRED)})")


def ensure_service_account():
    found = call(f"/core/users/?search={SERVICE_ACCOUNT}")
    for user in found.get("results") or []:
        if user.get("username") == SERVICE_ACCOUNT:
            print(f"service account exists: pk={user['pk']}")
            return user
    # The endpoint answers with user_pk and an app-password token; the token is
    # deliberate dead weight here — an API bearer is minted below with intent
    # "api", which is the kind that can call these endpoints at all.
    created = call("/core/users/service_account/", "POST", {"name": SERVICE_ACCOUNT, "create_group": False})
    user = call(f"/core/users/{created['user_pk']}/")
    if user.get("username") != SERVICE_ACCOUNT:
        # A generated handle would make the next run create a second account.
        user = call(
            f"/core/users/{user['pk']}/",
            "PATCH",
            {"username": SERVICE_ACCOUNT, "email": "", "is_active": True},
        )
    print(f"service account created: pk={user['pk']}")
    return user


def assign_role(role, user):
    call(f"/rbac/roles/{role['pk']}/add_user/", "POST", {"pk": user["pk"]})
    print(f"role {ROLE} assigned to user {user['pk']}")


def existing_token(user):
    # The listing ignores ?user=, so this filters here rather than trusting it.
    page = 1
    while True:
        payload = call(f"/core/tokens/?page_size=200&page={page}")
        for token in payload["results"]:
            if token.get("identifier") == TOKEN_IDENTIFIER and token.get("user") == user["pk"]:
                return token
        if not payload.get("pagination", {}).get("next"):
            return None
        page += 1


def vault_write(values):
    root_token = json.load(open(VAULT_INIT, encoding="utf-8"))["root_token"]
    request = urllib.request.Request(
        f"{VAULT_ADDR}/v1/{VAULT_PATH}",
        data=json.dumps({"data": values}).encode(),
        method="POST",
    )
    request.add_header("X-Vault-Token", root_token)
    request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            response.read()
    except urllib.error.HTTPError as error:
        raise SystemExit(f"vault write -> HTTP {error.code}: {error.read().decode()[:300]}")
    print(f"vault: wrote {VAULT_PATH} ({sorted(values)})")


def verify(token):
    """The new credential must be able to do the job, and no more."""
    results = {}
    try:
        call("/core/users/?page_size=1", token=token)
        results["read users"] = "ok"
    except SystemExit as error:
        results["read users"] = str(error)
    probe = {"username": f"orion-probe-{secrets.token_hex(3)}", "name": "Orion probe", "type": "internal"}
    created = call("/core/users/", "POST", probe, token=token)
    group = ensure_group()
    try:
        call(
            f"/core/users/{created['pk']}/set_password/",
            "POST",
            {"password": secrets.token_urlsafe(18)},
            token=token,
        )
        results["set password"] = "ok"
        call(
            f"/core/groups/{group['pk']}/add_user/",
            "POST",
            {"pk": created["pk"]},
            token=token,
        )
        results["join group"] = "ok"
    finally:
        call(f"/core/users/{created['pk']}/", "DELETE")
        results["delete"] = "ok"
    # Minting a token for somebody else would turn a person-provisioner into an
    # administrator. Minting one for itself is Authentik's own self-service and
    # grants nothing it does not already hold.
    for candidate in (1, 2, 5):
        try:
            call("/core/tokens/", "POST", {"identifier": "should-not-work", "user": candidate}, token=token)
        except SystemExit:
            results["mint for another user"] = "refused"
            break
        call("/core/tokens/should-not-work/", "DELETE")
    else:
        results["mint for another user"] = "ALLOWED (too much)"
    try:
        call(
            f"/core/users/{user_pk}/",
            "PATCH",
            {"is_superuser": True},
            token=token,
        )
        results["make itself superuser"] = "ALLOWED (too much)"
    except SystemExit:
        results["make itself superuser"] = "refused"
    print("verification:", json.dumps(results, sort_keys=True))
    too_broad = [name for name, value in results.items() if "ALLOWED" in str(value)]
    if too_broad:
        raise SystemExit(f"the new credential is too broad: {too_broad}; tighten the role")
    broken = [name for name, value in results.items() if value != "ok" and value != "refused"]
    if broken:
        raise SystemExit(f"the new credential cannot do its job: {broken}")
    return results


group = ensure_group()
role = ensure_role()
assign_permissions(role)
user = ensure_service_account()
user_pk = user["pk"]
assign_role(role, user)

token = existing_token(user)
if token is not None:
    print(f"token exists: pk={token['pk']} — reusing it")
else:
    token = call(
        "/core/tokens/",
        "POST",
        {
            "identifier": TOKEN_IDENTIFIER,
            "user": user["pk"],
            "intent": "api",
            "description": "Orion NAS: creates sign-ins when an administrator adds a person",
            "expiring": False,
        },
    )
    print(f"token minted: pk={token['pk']}")

# The API returns a token without its secret; view_key is the one read of it.
key = call(f"/core/tokens/{TOKEN_IDENTIFIER}/view_key/")["key"]
verify(key)
vault_write(
    {
        "authentik_api_url": API,
        "authentik_token": key,
        "group": GROUP,
    }
)
print(f"done — Orion reads ORION_AUTHENTIK_URL/TOKEN from the vault path {VAULT_PATH}")
