# Hosting Panel — Lightweight Static Website Hosting

Self-hosted static website hosting platform with upload-and-deploy workflow, per-project subdomains, rollback, quotas, metrics and auditing.

## Architecture

- **`apps/api`** — Fastify API (auth, projects, uploads, deployments, rollback, domains, files, dashboard, metrics, health).
- **`apps/worker`** — Background worker that claims QUEUED deployments, extracts archives, swaps live symlinks, applies nginx config and runs rollbacks. Supports multiple workers (Postgres advisory locks + `FOR UPDATE SKIP LOCKED`).
- **`apps/admin` / `apps/client`** — React frontends (not covered by this repo's hardening focus).
- **`packages/*`** — shared libraries: `auth`, `database` (Prisma), `deploy`, `errors` (domain errors + codes), `monitoring`, `nginx`, `shared` (roles/permissions, engine defaults, domain events), `storage`, `logger`.

```
pnpm-workspace.yaml          pnpm monorepo
prisma/                      schema + migrations + seed
scripts/create-env.mjs       generates .env from .env.example
```

## Prerequisites

- Node.js >= 20.19 (developed on 24.x)
- pnpm >= 9 (lockfile made with pnpm 11)
- PostgreSQL (local `docker run` documented below)
- system nginx (used by the deploy engine to serve sites)

## Setup

```bash
pnpm install
cp .env.example .env            # then edit values
pnpm db:generate
docker run -d --name hosting-pg \
  -e POSTGRES_USER=hosting_panel -e POSTGRES_PASSWORD=change-me \
  -e POSTGRES_DB=hosting_panel -p 5433:5432 postgres:16
pnpm db:deploy                  # applies migrations
pnpm db:studio                  # optional
pnpm run setup                  # creates .env from .env.example (no-op if present)
```

Bootstrap the admin user:

```bash
pnpm prisma db seed
# seeded from ADMIN_EMAIL / ADMIN_PASSWORD in .env (both are required, no defaults)
```

## Running

```bash
pnpm dev:api        # API on http://localhost:3000
pnpm dev:worker     # background deployment worker
pnpm dev:admin      # admin UI
pnpm dev:client     # client UI
```

Production build + run:

```bash
pnpm build
node apps/api/dist/index.js
node apps/worker/dist/index.js
```

## Verification commands

```bash
pnpm build            # tsup build, all packages in topological order
pnpm lint             # eslint across all workspaces
pnpm typecheck        # strict tsc (exactOptionalPropertyTypes, noUnused*)
pnpm test             # vitest run (unit + integration of packages)
pnpm db:validate      # prisma schema validation
pnpm format:check     # prettier
```

## Configuration

Both `apps/api` and `apps/worker` validate their environment at startup with zod and exit (code 1) on invalid values.

Key variables (`see .env.example`):

| Variable                                                         | Purpose                                             |
| ---------------------------------------------------------------- | --------------------------------------------------- |
| `DATABASE_URL`                                                   | PostgreSQL connection string                        |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`                               | at least 32 chars, production must use real secrets |
| `UPLOAD_DIRECTORY`                                               | staging area for uploaded archives                  |
| `SITE_DIRECTORY`                                                 | live + `.vN` version directories                    |
| `BACKUP_DIRECTORY`, `TEMP_DIRECTORY`, `LOG_DIRECTORY`            | backups, extraction temp, structured logs           |
| `PUBLIC_BASE_DOMAIN`, `NGINX_PORT`                               | subdomain wildcard + nginx listening port           |
| `UPLOAD_MAX_SIZE_MB`, `MAX_ZIP_ENTRIES`, `MAX_EXTRACTED_SIZE_MB` | upload/extraction limits                            |
| `MAX_ATTEMPTS`, `STALE_AFTER_MINUTES`                            | worker retry + orphan recovery thresholds           |
| `WORKER_POLL_MS`, `WORKER_HEARTBEAT_MS`                          | worker loop timing                                  |

## Production notes

- nginx must have a wildcard server for `*.PUBLIC_BASE_DOMAIN`; the worker writes per-project configs into `NGINX_SITES_AVAILABLE` and reloads with `nginx -t` + signal reload.
- Systemd units (`ExecStart=node apps/api/dist/index.js` and the worker) should restart on failure; the worker recovers orphaned RUNNING deployments at startup.
- Secrets must be rotated from the `.env` defaults before any public exposure.
