#!/usr/bin/env python3
"""Create Orion's sign-in in Authentik (runs on the edge host).

One OIDC client, one application. The redirect URI is the oauth2-proxy
callback at the public hostname — the proxy, not the desktop, talks to
Authentik. Idempotent: re-running reuses the provider and only rewrites the
local env file.

    python3 provision-authentik.py
"""

import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.request

CERULEAN_ENV = "/usr/src/projects/complete/1-primary/cerulean/.env"
OUT = os.environ.get("ORION_SSO_ENV", "/root/orion-sso/orion-sso.env")
HOST = "nas.innotel.us"
PROVIDER_NAME = "Orion NAS"
APP_SLUG = "orion"
APP_NAME = "Orion NAS"

# Copied from the estate's existing OIDC providers so the flows and signing key
# are the same ones every other application uses.
AUTHORIZATION_FLOW = "0429749a-74c5-44b0-91b1-a3a81b6751cb"
INVALIDATION_FLOW = "6f3bafe8-7000-4e04-823b-fba1c946642e"
SIGNING_KEY = "1a438dc3-4b6a-4cd1-beb2-de8d56f1edc3"

# Authentik's stock `email` mapping returns `"email_verified": False`, which
# oauth2-proxy refuses: the callback dies with HTTP 500 and the log says the
# id_token's email isn't verified. The estate's own mapping says True, because
# the address comes from this directory and nowhere else. Use it, never the
# default one.
EMAIL_MAPPING = "2f43cd0a-2de6-4443-9ee6-84db4d2a29f3"
DEFAULT_EMAIL_MAPPING = "6c78e0c1-a6b3-4446-b945-26b6adeb2ebc"
MAPPINGS = [
    "9edf050c-3bc1-4dee-b59e-62eee652fdaa",  # openid
    EMAIL_MAPPING,  # email, with email_verified true
    "369b13da-9ef0-4592-b15e-2edf4b7addd2",  # profile
    "90c10b21-babd-4a68-8e55-e8b1caeb8c04",  # groups (Innotel mapping)
]

# Authentik's API defaults this to an EMPTY list when a provider is created
# without it, and an empty list allows no grant at all: every
# response_type=code request is answered with `error=invalid_request` before
# the user even sees a login form, and the proxy turns that into a 403.
GRANT_TYPES = ["authorization_code", "refresh_token"]

env = {}
for line in open(CERULEAN_ENV):
    match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line.rstrip("\n"))
    if match:
        env[match.group(1)] = match.group(2).strip().strip('"').strip("'")

API = env["AUTHENTIK_API_URL"].rstrip("/")
if not API.endswith("/api/v3"):
    API += "/api/v3"
TOKEN = env["AUTHENTIK_BOOTSTRAP_TOKEN"]


def call(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(API + path, data=data, method=method)
    request.add_header("Authorization", "Bearer " + TOKEN)
    request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode()
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as error:
        raise SystemExit(
            f"{method} {path} -> HTTP {error.code}: {error.read().decode()[:400]}"
        )


def find_provider():
    for provider in call("/providers/oauth2/?page_size=200")["results"]:
        if provider["name"] == PROVIDER_NAME:
            return provider
    return None


def find_app():
    for application in call("/core/applications/?page_size=200")["results"]:
        if application["slug"] == APP_SLUG:
            return application
    return None


provider = find_provider()
if provider is None:
    provider = call(
        "/providers/oauth2/",
        "POST",
        {
            "name": PROVIDER_NAME,
            "authorization_flow": AUTHORIZATION_FLOW,
            "invalidation_flow": INVALIDATION_FLOW,
            "client_type": "confidential",
            "client_id": secrets.token_urlsafe(32),
            "client_secret": secrets.token_urlsafe(64),
            "property_mappings": MAPPINGS,
            "redirect_uris": [
                {
                    "matching_mode": "strict",
                    "url": f"https://{HOST}/oauth2/callback",
                    "redirect_uri_type": "authorization",
                }
            ],
            "signing_key": SIGNING_KEY,
            "grant_types": GRANT_TYPES,
            "include_claims_in_id_token": True,
            "sub_mode": "hashed_user_id",
            "issuer_mode": "per_provider",
            "access_code_validity": "minutes=5",
            "access_token_validity": "minutes=60",
        },
    )
    print(f"provider created: pk={provider['pk']} name={provider['name']}")
else:
    print(f"provider exists: pk={provider['pk']}")
    # Repair what an earlier version of this script created: a provider with no
    # grant types, or one still holding Authentik's unverified-email mapping.
    wanted = [mapping for mapping in GRANT_TYPES if mapping not in provider["grant_types"]]
    patch = {}
    if wanted:
        patch["grant_types"] = provider["grant_types"] + wanted
    if DEFAULT_EMAIL_MAPPING in provider["property_mappings"]:
        patch["property_mappings"] = [
            EMAIL_MAPPING if mapping == DEFAULT_EMAIL_MAPPING else mapping
            for mapping in provider["property_mappings"]
        ]
    if patch:
        provider = call(f"/providers/oauth2/{provider['pk']}/", "PATCH", patch)
        print(f"  repaired: {sorted(patch)}")
    print(f"  grant_types={provider['grant_types']}")

application = find_app()
if application is None:
    application = call(
        "/core/applications/",
        "POST",
        {
            "name": APP_NAME,
            "slug": APP_SLUG,
            "provider": provider["pk"],
            "meta_launch_url": f"https://{HOST}/",
            "policy_engine_mode": "any",
            "open_in_new_tab": False,
        },
    )
    print(f"application created: slug={application['slug']}")
else:
    print(f"application exists: slug={application['slug']}")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
lines = [
    "# Written by provision-authentik.py — the Orion NAS OIDC client.",
    f"OAUTH2_PROXY_CLIENT_ID={provider['client_id']}",
    f"OAUTH2_PROXY_CLIENT_SECRET={provider['client_secret']}",
    f"OAUTH2_PROXY_COOKIE_SECRET={secrets.token_urlsafe(32)[:32]}",
]
with open(OUT, "w", encoding="utf-8") as handle:
    handle.write("\n".join(lines) + "\n")
os.chmod(OUT, 0o600)
print(f"wrote {OUT} with the client id, secret and a fresh cookie secret")
print(f"issuer: {API.rsplit('/api/v3', 1)[0]}/application/o/{APP_SLUG}/")
