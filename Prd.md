# Product Requirements Document (PRD)
## Hosting Panel — Lightweight Static Website Hosting Platform

| Field | Value |
|---|---|
| Document Owner | Project Owner |
| Status | Draft v1.0 |
| Last Updated | 2026-08-02 |
| Applies To | All engineering phases (Phase 1 → Phase N) |

> **Governing rule:** This document is the single source of truth for the project. Any implementation, at any phase, must strictly follow what is written here. No undocumented features, endpoints, tables, or behaviors may be added without first updating this PRD.

---

## 1. Overview

Hosting Panel is a **self-hosted, production-ready static website hosting platform**, conceptually similar to Netlify/Vercel but intentionally narrow in scope: it hosts **HTML, CSS, and Vanilla JavaScript** sites only. There is no server-side runtime, no build step, and no containerized app hosting. Users upload a `.zip` of a static site; the platform validates, extracts, and deploys it behind Nginx, optionally with a custom domain and free TLS via Certbot.

The platform ships with two user-facing surfaces (Admin and Client) backed by a single API and an asynchronous Worker for heavy/long-running operations (extraction, deployment, SSL issuance, backups).

---

## 2. Goals & Non-Goals

### 2.1 Goals
- Provide a simple, secure, self-hosted alternative to Netlify/Vercel for static sites only.
- Fully automate the upload → validate → extract → deploy → serve pipeline.
- Give clients self-service control over projects, domains, SSL, files, and rollback.
- Give admins full operational visibility and control (users, projects, server health, logs).
- Be secure by default: no code execution, strict upload validation, isolated project directories.
- Be maintainable: clean layered/modular architecture, strict typing, repository pattern, DI.

### 2.2 Non-Goals (explicitly out of scope)
- Hosting PHP, WordPress, Laravel, Python, or any server-side runtime.
- Node.js application hosting or Docker-based deployments for end-user sites.
- Build pipelines / bundlers for user-uploaded sites (no npm install, no compilation).
- Multi-region or multi-server load balancing (single-server architecture for v1).
- Executing any uploaded file under any circumstance.

---

## 3. Target Users / Personas

| Persona | Description | Primary Needs |
|---|---|---|
| **Admin** | Platform operator managing the whole server and all tenants | Oversight, moderation, server health, security |
| **Client** | End user hosting one or more static websites | Fast upload/deploy, custom domains, SSL, rollback, usage visibility |

---

## 4. Scope

### 4.1 Supported site content
- HTML
- CSS
- Vanilla JavaScript (client-side only)

### 4.2 Explicitly not supported
- PHP
- WordPress
- Laravel
- Python
- Node.js hosting
- Docker-based deployment

Uploaded content is extracted as-is into `/var/www/sites/<project>` and served directly by Nginx as static files. No server-side processing of uploaded content occurs at any point.

---

## 5. Existing Infrastructure

**Hypervisor:** Proxmox VE

| Container | OS | IP | Hostname | Role |
|---|---|---|---|---|
| Container 1 | Ubuntu Server 24 | 10.20.30.101 | webserver | Nginx, Node.js, PM2 |
| Container 2 | Ubuntu Server 24 | 10.20.30.102 | postgres | PostgreSQL 16 |

**Database**

| Property | Value |
|---|---|
| Name | `hosting_panel` |
| Encoding | UTF8 |
| Locale | `C.utf8` |
| Auth Method | SCRAM-SHA-256 |

---

## 6. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite, TailwindCSS, TanStack Query, React Router, Zustand |
| Backend | Node.js, Fastify, TypeScript, Prisma ORM |
| Database | PostgreSQL 16 |
| Auth | JWT Access Token + Refresh Token, HttpOnly Cookies |
| Deployment | Nginx, Certbot, PM2 |
| Package Manager | pnpm Workspace |
| Monorepo Tooling | Turborepo |
| Validation | Zod |
| Code Quality | ESLint, Prettier, strict TypeScript |

---

## 7. Architecture

Clean Architecture, enforced across a pnpm/Turborepo monorepo. Each package has a single, well-defined responsibility with clear boundaries and dependency injection between layers.

```
hosting-panel/
├── apps/
│   ├── admin/        # Admin dashboard (React)
│   ├── client/        # Client dashboard (React)
│   ├── api/            # Fastify API server
│   └── worker/       # Background job processor
├── packages/
│   ├── auth/          # JWT/refresh/session logic
│   ├── database/    # Prisma client, repositories
│   ├── deploy/       # Deployment pipeline
│   ├── logger/        # Audit/deploy/error/access logging
│   ├── monitoring/ # CPU/RAM/disk/uptime metrics
│   ├── nginx/         # Nginx config generation & control
│   ├── storage/      # Upload/delete/rename/file mgmt
│   ├── shared/        # Shared types, constants, utils
│   └── ui/                # Shared UI component library
├── prisma/            # Schema & migrations
└── scripts/          # Operational/dev scripts
```

### 7.1 Module Responsibilities

**API (`apps/api`)**
- Authentication (login, refresh, logout)
- User API
- Project API
- Upload API
- Deploy API
- SSL API
- Domain API
- Monitoring API

**Worker (`apps/worker`)**
- ZIP extraction
- Deployment execution
- SSL certificate generation
- Backups
- Cleanup of temp/orphaned files
- Rollback execution

**`packages/deploy`**
- Orchestrates the deployment pipeline
- Deployment validation
- File copy to `/var/www/sites`
- Nginx config generation
- Nginx reload

**`packages/storage`**
- Upload handling
- Delete / rename
- General file management under managed directories

**`packages/nginx`**
- Generate per-project Nginx config
- Enable / disable site
- Reload Nginx
- Validate configuration before applying (`nginx -t` equivalent)

**`packages/logger`**
- Audit log
- Deploy log
- Error log
- Access log

**`packages/monitoring`**
- CPU usage
- RAM usage
- Disk usage
- Uptime
- Per-project storage usage

---

## 8. Data Model

Prisma schema must include, at minimum, the following entities. Exact fields/relations are defined during schema design but must satisfy the responsibilities below.

| Table | Purpose |
|---|---|
| `User` | Platform account (admin or client) |
| `Project` | A hosted static site belonging to a user |
| `Domain` | Custom/subdomain mapped to a project |
| `Deployment` | A single deploy event for a project |
| `DeploymentHistory` | Historical record of deployments (for rollback) |
| `File` | Tracked file/asset metadata within a project |
| `ActivityLog` | User-facing activity timeline |
| `Session` | Active login session |
| `RefreshToken` | Issued refresh tokens (rotation/revocation support) |
| `AuditLog` | Security/administrative audit trail |
| `Notification` | User notifications |
| `Backup` | Backup record/metadata |
| `Role` | Role definition (Admin, Client, extensible) |
| `Permission` | Granular permission definition |
| `UserRole` | User ↔ Role join table |

---

## 9. Roles & Permissions

### 9.1 Admin
- Manage users
- Manage projects
- Suspend website
- Delete website
- View logs
- View monitoring
- Manage SSL
- Manage domains

### 9.2 Client
- Upload website
- Deploy
- Rollback
- Manage files
- Manage domains
- Enable SSL
- View logs
- View own storage usage

Role/permission checks must be enforced server-side on every API route, not just hidden in the UI. Use the `Role` / `Permission` / `UserRole` tables rather than hardcoded role strings.

---

## 10. Dashboards

### 10.1 Admin Dashboard
- Total Users
- Total Websites
- Active Websites
- Suspended Websites
- CPU Usage
- RAM Usage
- Disk Usage
- Storage Usage
- Recent Deployments
- Recent Activities

### 10.2 Client Dashboard
- Projects
- Storage Usage
- Domains
- SSL Status
- Deploy History
- Activity Timeline

---

## 11. Upload & Deployment Flow

```
Receive upload
      ↓
Validate file (type, size)
      ↓
Validate ZIP structure
      ↓
Extract to a safe temp location
      ↓
Verify index.html exists
      ↓
Reject dangerous files
      ↓
Create project directory
      ↓
Copy files into /var/www/sites/<project>
      ↓
Generate Nginx config
      ↓
Validate Nginx configuration
      ↓
Reload Nginx
      ↓
Deployment completed
```

Any failure at any stage must trigger a clean rollback and leave the previously deployed version (if any) untouched and serving.

---

## 12. Security Requirements

Mandatory, non-negotiable controls:

- JWT access tokens + refresh tokens (HttpOnly cookies)
- Argon2id password hashing
- Helmet (secure HTTP headers)
- CORS restricted to known origins
- CSRF protection where applicable (cookie-based flows)
- Rate limiting on auth and upload endpoints
- Upload validation (extension allow-list, size limits)
- MIME type validation (not trusted from filename alone)
- ZIP validation (zip-bomb protection, entry count/size limits, path traversal checks inside archive)
- Path traversal protection on all filesystem operations
- SQL injection protection (Prisma parameterization; no raw string concatenation)
- XSS protection on all rendered/admin-viewable content
- Full audit logging of security-relevant actions

**Absolute rules:**
- Never execute uploaded files.
- Never allow executable uploads (no `.php`, `.sh`, `.exe`, server-side scripts, etc.).
- Never allow uploads or writes outside the assigned project directory.

---

## 13. Deployment Engine

The deployment engine must, for every deploy:
1. Generate the Nginx configuration for the project/domain.
2. Validate the configuration before applying it.
3. Enable the site.
4. Reload Nginx.
5. Automatically roll back to the last known-good deployment on any failure.

---

## 14. Storage Layout

| Path | Purpose |
|---|---|
| `/var/www/sites` | Live, served static site files |
| `/var/uploads` | Temporary/raw uploaded archives prior to extraction |
| `/var/log/hosting` | Application/audit/deploy/access logs |
| `/var/backups` | Backup archives |

No hardcoded paths in application code — all paths must be sourced from environment variables.

---

## 15. Non-Functional Requirements

- **Strict TypeScript** across all apps/packages (no implicit `any`).
- **ESLint + Prettier** enforced via CI and pre-commit hooks.
- **Zod** validation on all external input (API payloads, env vars, config).
- **Environment variables only** for configuration — no hardcoded secrets or paths.
- **Dependency Injection** for services (testability, swappable implementations).
- **Repository Pattern** for all database access (no direct Prisma calls from route handlers).
- **Service Layer** separating business logic from HTTP/transport concerns.
- **Modular architecture** — one responsibility per file/module.
- No mock implementations in production code paths unless explicitly requested.

---

## 16. Success / Acceptance Criteria

A phase is considered complete only when:
- All configuration/code for that phase matches this PRD exactly — nothing more, nothing less.
- The monorepo builds and lints cleanly via Turborepo.
- Strict TypeScript compiles with no errors.
- Prisma schema (once introduced) validates and migrates cleanly against `hosting_panel`.
- No hardcoded secrets, IPs, or filesystem paths exist in source.
- Security controls relevant to that phase are demonstrably in place (not deferred silently).

---

## 17. Phased Delivery Plan

Development proceeds strictly one phase at a time. **Do not begin a phase until the previous phase is explicitly approved.**

### Phase 1 — Bootstrap (current phase)
- Initialize monorepo (pnpm workspace + Turborepo)
- Configure TypeScript (strict mode, shared base config)
- Configure ESLint + Prettier
- Configure Prisma (connection to `hosting_panel`, no schema modeling yet unless scoped)
- Configure Fastify (base app, no business routes yet)
- Configure React (Vite, Tailwind) for `admin` and `client` apps
- Configure environment variables (`.env` schema via Zod)
- Create the full folder structure defined in Section 7
- Create shared packages (empty/scaffolded with correct responsibility boundaries)

**Stop after Phase 1 and wait for explicit approval before starting Phase 2.**

### Future Phases (to be scoped individually, not implemented in advance)
- Phase 2+: Authentication (JWT/refresh/session), User & Role/Permission tables
- Phase N: Project & Domain APIs
- Phase N: Upload API + `storage` package
- Phase N: Worker (extraction) + `deploy` + `nginx` packages
- Phase N: SSL (Certbot) integration
- Phase N: Monitoring package + Admin/Client dashboards
- Phase N: Backup/rollback, audit logging, hardening pass

Exact phase boundaries beyond Phase 1 will be defined when that phase is scoped — they are not to be assumed or pre-built.

---

## 18. Development Rules (Standing, Apply to Every Phase)

- Follow this PRD strictly; it is the single source of truth.
- Only implement the current phase's next unfinished task.
- No undocumented additions — if it's not in this PRD, raise it before building it.
- Maintain clean layered architecture and one-responsibility-per-file at all times.
- Every feature delivered must be production-ready, not a placeholder, unless explicitly requested as such.

---

## 19. Risks & Assumptions

| Risk / Assumption | Notes |
|---|---|
| Single-server architecture | No HA/failover in v1; acceptable for initial scope |
| Nginx reload on every deploy | Must be validated first to avoid downtime on bad config |
| ZIP-based upload only | Large sites may need chunked upload support later |
| No sandboxing beyond validation | Relies entirely on strict upload/extraction validation since no execution occurs |
| Two-container topology (web + db) | Network/firewall rules between 10.20.30.101 and 10.20.30.102 assumed to already permit required traffic |

---

## 20. Open Questions (to resolve before/at relevant phase)

- Exact JWT/refresh token lifetimes and rotation policy.
- Per-client storage quotas and enforcement point (upload-time vs. background check).
- Domain verification method (DNS TXT record vs. other) before enabling SSL.
- Backup retention policy and storage limits.
- Notification delivery channels (in-app only vs. email).
