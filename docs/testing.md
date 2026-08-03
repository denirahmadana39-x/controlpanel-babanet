# Testing & Verification

This guide documents how to verify the Babasti Hosting stack locally before
committing, pushing, or deploying, and how the automated smoke tests work.

## Quick start

```bash
pnpm verify
```

One command that runs the full local production verification pipeline and ends
with a pass/fail report. On success it prints:

```
Babasti Hosting Verification

✔ Format
✔ Lint
✔ Typecheck
✔ Tests (65 passed)
✔ Build
✔ Prisma (validate + migrate status)
✔ Environment
✔ API
✔ Worker
✔ Health Checks
✔ Smoke Tests

Verification completed successfully.

Safe to:
git add .
git commit
git push
```

If any step fails, verification stops immediately and prints a `FAILED` block
with the step name, the reason, and a suggested fix.

## What `pnpm verify` checks

`pnpm verify` runs `scripts/verify.mjs`, which executes these steps in order
and stops at the first failure:

| Step            | Command                                        | Expects                                                      |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| Format          | `pnpm format:check`                            | Prettier-clean repository                                    |
| Lint            | `pnpm lint`                                    | ESLint clean (all packages)                                  |
| Typecheck       | `pnpm typecheck`                               | TypeScript strict, all packages                              |
| Tests           | `pnpm test`                                    | All unit tests pass                                          |
| Build           | `pnpm build`                                   | All packages and apps build                                  |
| Prisma validate | `pnpm exec prisma validate`                    | Schema is valid                                              |
| Prisma migrate  | `pnpm exec prisma migrate status`              | No pending migrations                                        |
| Environment     | reads `.env`                                   | Required variables present (see below)                       |
| API             | starts `apps/api/dist/index.js` on a temp port | `GET /health` returns HTTP 200                               |
| Worker          | starts `apps/worker/dist/index.js`             | Worker registers + heartbeats                                |
| Health Checks   | polls `GET /health`                            | `database: connected`, `worker: initialized`, `queue: ready` |
| Smoke Tests     | `node scripts/smoke.mjs <apiUrl>`              | See checklist below                                          |

The API and Worker are temporary child processes started on a free port
(overriding `PORT`) and are always shut down gracefully afterwards, including
on failure. Their logs are written to the verification log directory
(`$VERIFY_LOG_DIR`, default `$(mktemp -d)/opencode` → `verify-api.log` and
`verify-worker.log`). The API is started after the build step, so it runs from
the freshly built `dist` output.

### Environment variables validated

The `Environment` step requires the following variables to be present and
non-empty in `.env`:

| Variable             | Maps to (task naming) | Purpose                           |
| -------------------- | --------------------- | --------------------------------- |
| `DATABASE_URL`       | `DATABASE_URL`        | Database connection string        |
| `JWT_SECRET`         | `JWT_SECRET`          | Auth signing secret (>= 32 chars) |
| `JWT_REFRESH_SECRET` | —                     | Auth refresh secret (>= 32 chars) |
| `UPLOAD_DIRECTORY`   | `UPLOAD_ROOT`         | Upload root                       |
| `SITE_DIRECTORY`     | `WEBSITE_ROOT`        | Live sites + version dirs         |
| `TEMP_DIRECTORY`     | `DEPLOY_ROOT`         | Deploy extraction temp            |
| `BACKUP_DIRECTORY`   | `BACKUP_ROOT`         | Backup root                       |
| `LOG_DIRECTORY`      | `LOG_ROOT`            | Log root                          |

`JWT_REFRESH_SECRET` is required in addition to the seven task-named roots
because the API env schema has no default for it. If a variable is missing,
verification stops before any server is started.

## Health endpoint

Both `GET /health` and `GET /api/health` return HTTP 200 with component status:

```json
{
  "status": "ok",
  "uptime": 42,
  "timestamp": "2026-08-03T00:00:00.000Z",
  "database": "connected",
  "worker": "initialized",
  "queue": "ready"
}
```

- `database`: `connected` after `SELECT 1` succeeds, otherwise `disconnected`.
- `worker`: `initialized` when at least one worker heartbeat is fresh (10 min
  staleness window), otherwise `not-initialized`.
- `queue`: `ready` when no deployment has been `QUEUED`/`RUNNING` for longer
  than 2 minutes, otherwise `blocked`.

The response keeps `status: "ok"` regardless so load balancers treat the
process as up; the component fields are what the verification gate asserts on.

## Smoke tests

`scripts/smoke.mjs <apiBaseUrl>` performs a full authenticated walk through the
platform against the given API. It never depends on pre-existing data: it
creates a temporary project (`verify-*`) and deletes it afterwards (even on
failure). Checks performed:

1. Health endpoint reports `connected` / `initialized` / `ready`.
2. Admin login returns a user and a CSRF token.
3. Dashboard endpoint is accessible.
4. Create a temporary project (201).
5. The project appears in the project list.
6. Uploading a non-zip file is rejected (400).
7. Uploading a valid zip (v1) is accepted (201).
8. Deployment v1 reaches `SUCCEEDED`.
9. The deployments endpoint lists the deployment.
10. Uploading a second zip (v2) is accepted and reaches `SUCCEEDED`.
11. Rollback to v1 is accepted (201).
12. The rollback deployment reaches `SUCCEEDED`.
13. The site endpoint reflects the rolled-back version.
14. Nginx serves the rolled-back v1 content (via the `Host` header on the
    platform's nginx port).
15. The metrics endpoint is accessible.
16. The temporary project is deleted (204).

The nginx check uses `node:http` because Node's `fetch` (undici) ignores a
custom `Host` header, which would route the request to nginx's default server
instead of the deployed site.

### Smoke test configuration

| Env var                 | Default                 | Purpose                                 |
| ----------------------- | ----------------------- | --------------------------------------- |
| `VERIFY_ADMIN_EMAIL`    | `.env` `ADMIN_EMAIL`    | Admin login email                       |
| `VERIFY_ADMIN_PASSWORD` | `.env` `ADMIN_PASSWORD` | Admin login password                    |
| `VERIFY_SKIP_NGINX`     | unset                   | Set to `1` to skip the nginx site check |
| `VERIFY_LOG_DIR`        | `$(mktemp -d)/opencode` | Directory for temporary server logs     |

## Common failures and fixes

| Failure                  | Likely cause                                      | Fix                                            |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------- |
| `Format` fails           | Unformatted files                                 | `pnpm format` then re-run `pnpm verify`        |
| `Lint` fails             | ESLint errors                                     | `pnpm lint -- --fix`, fix remaining, re-run    |
| `Typecheck` fails        | Type errors                                       | Fix reported errors, re-run                    |
| `Tests` fails            | Unit test failure                                 | Fix failing test, re-run                       |
| `Build` fails            | Build error                                       | Fix build error, re-run                        |
| `Prisma ... failed`      | Schema invalid or pending migrations              | `pnpm db:validate` / `pnpm db:deploy`          |
| `Environment` fails      | `.env` missing or incomplete                      | `pnpm setup`, fill in required values          |
| `API` fails to start     | Bad env, port, or startup error                   | Review the `verify-api.log` tail printed       |
| `Worker` not initialized | Worker crashed or heartbeat stale                 | Review `verify-worker.log`; ensure Postgres up |
| `Health Checks` blocked  | Deployment stuck `QUEUED`/`RUNNING` > 2 min       | Check worker is running and processing jobs    |
| Smoke `Login` 429        | Login rate limit (5 / 15 min) hit by earlier runs | Wait for the window, or restart the temp API   |
| Smoke nginx check fails  | nginx not running or config not applied           | Start nginx; check `nginx -t`                  |

## Individual commands

Run the pipeline steps one at a time if you only need a subset:

```bash
pnpm format:check   # format gate
pnpm lint           # lint gate
pnpm typecheck      # type gate
pnpm test           # unit tests
pnpm build          # production build
pnpm db:validate    # prisma validate
pnpm db:deploy      # apply migrations (prisma migrate status equivalent)
node scripts/smoke.mjs http://127.0.0.1:3000   # smoke against a running API
```

## Deployment checklist

Run `pnpm verify` and confirm the final report ends with
`Verification completed successfully.` before:

1. Creating a commit (`git add .` / `git commit`).
2. Pushing (`git push`).
3. Deploying the API and Worker artifacts (`apps/api/dist`,
   `apps/worker/dist`) to the target host.
4. Applying migrations on the target host with `pnpm db:deploy`.
5. Restarting the API and Worker services on the target host.

A green `pnpm verify` on the target host (with its `.env`) is the strongest
signal that the deployment is safe.
