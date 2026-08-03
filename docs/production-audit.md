# Production Audit — No Fake / Mock / Dummy / Hardcoded Values

Scope: full repository search for `mock`, `fake`, `dummy`, `stub`, `sample`,
`placeholder`, `TODO production`, `FIXME`, `XXX`, `HACK`, hardcoded
`localhost`/IPs, hardcoded IDs/UUIDs, hardcoded JWTs/secrets, hardcoded
users/projects/domains/deployment-history/statistics, and test-only logic
(`NODE_ENV === "test"`, `isTest`, `__TEST__`) leaking into production paths.
Search excluded `node_modules`, `dist`, Prisma generated client, and
`pnpm-lock.yaml`.

## 1. Removed fake / mock / dummy / hardcoded code

- `prisma/seed.ts` (lines 65–74) — removed the hardcoded fallback admin
  credentials `admin@hosting.local` / `Admin12345!`. The seed now requires
  `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the environment and fails fast with a
  clear error if missing or below the password policy minimum. This removes the
  only hardcoded user credential in source.
- `README.md` (line 43) — updated the bootstrap comment to state both
  `ADMIN_EMAIL` and `ADMIN_PASSWORD` are required (no defaults).
- Verified the change with `pnpm prisma db seed` (idempotent upsert, exit 0)
  and the full `pnpm verify` pipeline (exit 0).

## 2. Remaining test-only fixtures (kept intentionally)

These are confined to test files and verification tooling; they never run in
production paths:

| Location                                             | Fixture                                 | Why kept                                   |
| ---------------------------------------------------- | --------------------------------------- | ------------------------------------------ |
| `packages/storage/src/zip.test.ts:108,110`           | `placeholder.txt` temp file             | unit-test input                            |
| `packages/deploy/src/pipeline.test.ts`               | `demo` / `demo.localhost` projects      | pipeline unit fixtures                     |
| `packages/nginx/src/generator.test.ts`               | `site.example.com` / `www.example.com`  | config-generator unit fixtures             |
| `packages/database/src/project-lock.test.ts:6,22,28` | hardcoded UUID `59eb4d08-…`             | lock-key unit fixtures                     |
| `scripts/smoke.mjs:28-29`                            | fallback admin creds / `localhost` base | verification tool only, reads `.env` first |
| `scripts/verify.mjs`                                 | `127.0.0.1` random free ports           | verification tool only                     |
| `.github/workflows/ci.yml:9`                         | `postgresql://ci:ci@localhost:5432/ci`  | CI test database only                      |

## 3. Production code audit (every pattern searched)

### 3.1 `mock` / `fake` / `dummy` / `stub` / `sample` / `placeholder`

- `packages/auth/src/password.ts:11-12,47-54` — `DUMMY_PASSWORD_HASH` is a
  **legitimate security control**: an argon2 verification against a fixed hash
  run on unknown-user logins so timing matches known-user failures
  (user-enumeration mitigation). Its result is discarded
  (`verifyDummyPassword` returns `void`) and the caller always throws
  `INVALID_CREDENTIALS` (`apps/api/src/modules/auth/auth.service.ts:37,47`).
  Never fakes success. Retained.
- UI `placeholder=` attributes (`packages/ui/src/pages/LoginPage.tsx:57,67`,
  `apps/admin/src/pages/{UsersPage,ProjectsPage,UserDetailPage}.tsx`,
  `apps/client/src/pages/ProjectsPage.tsx`) — standard form UX hints, not data.
- `packages/ui/src/components/primitives.tsx:47,64` — Tailwind `placeholder:`
  styling class.

### 3.2 `TODO` / `FIXME` / `XXX` / `HACK` / "not implemented"

- Only in governance docs, zero in code:
  - `Prd.md:382` future-phase scoping; `docs/production-readiness.md:74` and
    `docs/technical-debt.md:28` (HTTPS/ACME not implemented — documented
    blocker, front with TLS proxy).

### 3.3 Hardcoded `localhost` / addresses / ports

- All are **overridable configuration defaults**, `.env.example` templates,
  test fixtures, or verification scripts — none are production data paths:
  - `packages/shared/src/engine.ts:71-83` — `ENGINE_DEFAULTS` (single source
    of truth; API/worker env schemas derive defaults from it, env-overridable).
  - `apps/api/src/config/env.ts:36-38` — zod dev defaults for
    `CORS_ORIGINS` / `APP_URL` / `API_URL`.
  - `packages/ui/src/lib/api.ts:3` — `DEFAULT_BASE_URL`
    (`http://localhost:3000`) Vite fallback; overridden by `VITE_API_URL`
    (neither frontend ships a `.env`, so this is the dev default).
  - `.env.example`, `apps/admin/.env.example`, `apps/client/.env.example` —
    config templates.
  - `Prd.md:76-77,413` — target-infrastructure documentation (`10.20.30.x`).

### 3.4 Hardcoded IDs / UUIDs

- Only in tests (`packages/deploy/src/pipeline.test.ts:61`,
  `packages/database/src/project-lock.test.ts`). No hardcoded IDs in
  production routes or services.

### 3.5 Hardcoded JWTs / secrets

- None in source. `apps/api/src/config/env.ts:24-25` requires
  `JWT_SECRET`/`JWT_REFRESH_SECRET` ≥ 32 chars with no default. `.env.example`
  uses explicit `CHANGE_ME_…` markers (template). `.env` is gitignored.

### 3.6 Hardcoded users / projects / domains / deployment history / statistics

- None. Verified real DB/filesystem backing end to end:
  - Dashboards `apps/api/src/modules/dashboard/dashboard.routes.ts:88,160` —
    every count/summary comes from DB repositories; no fabricated values.
  - Monitoring `apps/api/src/modules/monitoring/monitoring.routes.ts:87,134,167`
    — `/api/system` from `node:os` + `statfs`, `/api/storage` and `/api/metrics`
    from DB usage/backup/deployment/worker counts; metrics snapshot is
    real-collected (`packages/monitoring/src/metrics.ts`).
  - Deployment pipeline `packages/deploy/src/pipeline.ts` — real filesystem
    writes + real nginx, wrapped in an advisory-lock transaction.
  - Worker `apps/worker/src/jobs/deployment-job.ts` — real claim/process/retry/
    dead-letter/cleanup; success is recorded only after real deploy + DB writes.
  - Nginx `packages/nginx/src/control.ts` — real `nginx -t` validation, real
    `nginx -s reload`, cross-process `FileLock`; no simulated reload.
  - Auth `apps/api/src/modules/auth/auth.service.ts` — real DB lookup, real
    argon2 verification, real session/refresh-token rotation, real audit logs.
  - Storage `packages/storage/src/*` — real filesystem paths/sizes/checksums.
  - All UI pages call real API endpoints; no static arrays, no `Math.random()`,
    no fabricated charts.

### 3.7 Test-only logic in production paths

- No `NODE_ENV === "test"` gating, `isTest`, `__TEST__`, or development
  shortcuts in production code.

## 4. Remaining blockers (operational, not fake data)

1. **Local `.env` secrets still dev defaults** (gitignored): `JWT_SECRET` /
   `JWT_REFRESH_SECRET` are `CHANGE_ME_…` and `ADMIN_PASSWORD` is
   `Admin12345!`. The verify pipeline requires these env vars, so they cannot
   be emptied; an operator must rotate them before any public exposure.
   Matches `docs/technical-debt.md:27` and `docs/production-readiness.md:68`.
2. **HTTPS/ACME not implemented** — front the API and sites with a TLS proxy
   (`docs/technical-debt.md:28`). Out of scope for this audit.
3. **Frontend API base URL** — the admin/client apps rely on the
   `http://localhost:3000` fallback unless `VITE_API_URL` is set at build time
   (`packages/ui/src/lib/api.ts:3`). Set per-environment in production builds.

## 5. Confirmation

- No fake, mock, dummy, sample, placeholder, simulated-success, or hardcoded
  data path remains in production code. Every production behavior is backed by
  real PostgreSQL, real filesystem operations, real nginx control, and the real
  worker queue; failures propagate real errors and the UI renders empty states
  instead of fabricated values.
- Test-only fixtures are confined to `*.test.ts` files and the `verify`/`smoke`
  tooling.
- `pnpm verify` completed green (exit 0): format, lint, typecheck,
  `Tests (65 passed)`, build, prisma validate + migrate status, environment,
  temp API, temp worker, health checks (database connected / worker
  initialized / queue ready), and smoke tests incl. real nginx site serving and
  cleanup.
