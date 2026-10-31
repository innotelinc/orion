# Orion in the Innotel Platform Stack

**Role: StorageOps** — A NAS desktop for one Incus container, and the service
that provisions one per subscriber. Pick a size, pay, and Orion builds the
container and its data volume.

Part of the [Innotel Platform Stack](https://github.com/innotelinc/innotel-platform-stack).
The canonical definition of the stack, its shared layers and their owners lives
there; this file records only what Orion does inside it.

## Boundaries

### Owns

- the dashboard and host facts
- files, trash and per-person spaces
- the app store and service controls
- SMB shares and storage views
- the small read/write API
- the subscription catalogue, paid-order intake and per-customer provisioning

### Consumes

- Cerulean (Authentik SSO via oauth2-proxy, DNS, TLS)
- ONYX (storage conventions and backups)
- NPM Edge (public host)

### Does not own

- the hypervisor (Incus)
- identity (Authentik)
- secrets (Cerulean Vault)
- backups (ONYX)

## Service map

| Component | Technology | Job |
| --- | --- | --- |
| Orion | Node.js / TypeScript | A NAS desktop for one Incus container, and the provisioner for each subscriber's. |
| Identity | Cerulean Authentik | Sign-in and role claims, where the repo has a UI |
| Secrets | Cerulean Vault (KV v2) | Production credentials, referenced as `vault://` |
| Trust | Cerulean | DNS, TLS and the public hostname |
| Edge | NPM Edge | The public route in front of the service |

## In the ecosystem

- **Identity** comes from Cerulean Authentik; this repo holds no second account
  table and no password of its own.
- **Secrets** come from Cerulean Vault. `.env` is local only and is never
  committed; a `vault://` reference is resolved by the deployment.
- **Trust and edge** are Cerulean's and NPM Edge's. This repo does not write DNS
  records or call the NPM API directly.
- **Storage, billing and telephony** belong to ONYX, Magnate and Zeus
  respectively; Orion consumes them only where the boundaries above say
  so.

## See also

- [README](../README.md)
- [Innotel Platform Stack](https://github.com/innotelinc/innotel-platform-stack)
