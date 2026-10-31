# Subscriptions and provisioning

Orion is sold as a **personal NAS**, not as a licence: every subscription is one
Incus container with its own data volume, and this document records what a plan
is, what it costs, and how a payment becomes a server.

## Plans

The catalogue lives in `server/orion-api.py` (`PLANS`) and is served at
`GET /api/plans`. The subscription page (`web/landing/subscribe.html`) renders
from that response, and the provisioning worker reads the same record, so a page
cannot advertise a size the machine will not create.

| Plan | Storage | Price | Billing SKU |
| --- | --- | --- | --- |
| Trial | 1 GB | $0 for 14 days | `orion-trial` |
| Starter | 5 GB | $5/month | `orion-starter` |
| General | 25 GB | $15/month | `orion-general` |
| Storage | 100 GB | $45/month | `orion-storage` |

`storageGb` is a **ceiling**. An order may ask for less than its plan (a 25 GB
plan ordered at 10 GB gets a 10 GB volume) and never more; growing past the plan
is a plan change. Prices are in cents in the catalogue and quoted by the page
exactly as stored.

Billing, invoices and cancellation belong to Magnate. The page's buttons carry
the SKU (`https://app.magnate.innotel.us/signup?plan=orion-general`), and the
plan record in Magnate must use the same string.

## From payment to server

```
buyer → /subscribe → Magnate checkout → payment clears
      → Magnate POSTs the paid order to /api/provision (HMAC-SHA256)
      → orion-api records it as `queued` and answers 202
      → the worker runs deploy/provision-container.sh
      → Incus volume + container, Orion installed inside it
      → order becomes `ready`, with address, share and a sign-in link
```

### The webhook

`POST /api/provision`, signed with `ORION_PROVISION_SECRET`:

```
X-Orion-Signature: sha256=<hex HMAC-SHA256 of the raw request body>
```

```json
{
  "orderId": "ord-2026-0001",
  "plan": "general",
  "email": "person@example.com",
  "paid": true,
  "storageGb": 25,
  "retry": false
}
```

- `orderId` is the idempotency key. The same id is the same server; a retried
  delivery returns the existing order with `200` instead of building a second
  one. The container's name is derived from it (`orion-<plan>-<8 hex>`).
- `paid` must be `true`. An unpaid order is a 400, never a free server.
- `storageGb` is optional and clamped to the plan's size.
- `retry: true` re-queues an order that previously **failed**. Nothing else may
  disturb a `ready` or `running` order.
- No secret configured → `503`, and nothing is queued.

The API answers `202` with the order. It never provisions inside the request: a
container takes minutes and a webhook has seconds.

### Reading an order

```
GET /api/provision/<orderId>
```

- `X-Orion-Secret: <ORION_PROVISION_SECRET>` — any order (the billing platform).
- a signed-in session whose address matches the order's, or a platform admin —
  their own order (the buyer).

`GET /api/provision` (no id) lists orders for the secret holder only.

Statuses: `queued`, `running`, `ready`, `failed`. A failed order keeps `error`
and the tail of the provisioner's log; a ready one keeps the container, volume,
size, address, SMB share and the one-time sign-in link in `result`.

Orders are files under `$ORION_ROOT/.orion/provisioning/`, so a restart resumes
a queue instead of forgetting it.

## The provisioner

`deploy/provision-container.sh` is the only thing that talks to Incus. It is
idempotent: re-running it repairs the existing volume and container instead of
creating a second one, which is what makes a retry safe.

It creates:

- a **custom storage volume** of the ordered size (zfs honours `size=`), and
  attaches it at `/srv/storage`;
- a **container** (`images:debian/12` by default) with `limits.memory` and
  `limits.cpu`;
- **nginx + orion-api + the built desktop**, copied from the machine running the
  provisioner, so the new server runs the same build as the fleet;
- **Samba and avahi**, which is what makes it a NAS on the LAN and not a web
  page;
- a per-container `ORION_SESSION_SECRET` and `ORION_CLAIM_SECRET`.

### Getting in the first time

A brand-new container is not in the identity provider yet, and Orion does not
want a second account table. The provisioner prints a one-time link instead:

```
python3 /opt/orion/orion-api.py --claim person@example.com http://<address>
```

`/auth/claim` verifies that HMAC token with the container's own
`ORION_CLAIM_SECRET`, sets a normal session for that address, and redirects to
the desktop. Links expire after seven days; they are handed out once, in the
order's `result`.

### Environment

| Key | Where | Meaning |
| --- | --- | --- |
| `ORION_PROVISION_SECRET` | `/etc/orion/api.env` | the webhook secret; absent means provisioning is off |
| `ORION_PROVISION_SCRIPT` | unit | path to the provisioner (`/opt/orion/provision-container.sh`) |
| `ORION_PROVISION_DIR` | optional | where orders are recorded (default `$ORION_ROOT/.orion/provisioning`) |
| `ORION_PROVISION_TIMEOUT` | optional | seconds before an order is failed (default 5400) |
| `ORION_INCUS_REMOTE` | unit | Incus remote the containers live on (`i1`) |
| `ORION_INCUS_POOL` | optional | storage pool (`incus`) |
| `ORION_PROVISION_IMAGE` | optional | image (`images:debian/12`) |
| `INCUS_CONF` | unit | client config holding this machine's certificate |
| `ORION_CLAIM_SECRET` | per container | signs the one-time sign-in link |

### The Incus client

The API runs inside a container and has no Incus daemon of its own, so it talks
to the host through the `incus` client and a certificate the host trusts:

```bash
apt-get install -y incus-client
mkdir -p /etc/orion/incus
INCUS_CONF=/etc/orion/incus/config incus remote generate-certificate
# on the Incus host, trust it:
incus config trust add-certificate /etc/orion/incus/config/client.crt \
  --name orion-provisioner --restricted=false
# back on the API host, add the remote without an interactive prompt:
INCUS_CONF=/etc/orion/incus/config \
  incus remote add i1 https://192.168.1.51:8443 --auth-type tls --accept-certificate
```

`orion-api.service` sets `INCUS_CONF=/etc/orion/incus/config`, so the worker's
`incus` calls use that certificate and not a stray root config.

## Boundaries

- The provisioner creates volumes and containers. It does not touch DNS, TLS or
  the edge proxy: those belong to Cerulean and NPM Edge, and a personal server
  is reached by its address (or a name Cerulean maps to it).
- A failed order leaves the container and volume in place for inspection. They
  are named after the order, so removing them is `incus delete` +
  `incus storage volume delete`, not a hunt.
- Deleting an order file is not a cancellation. Cancellation is a plan change in
  Magnate plus an operator removing the container; the API does not guess which
  of those happened.
