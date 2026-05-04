# Bank Loan Service

A **NestJS** HTTP API for a simplified bank-style loan product: customers register, authenticate with JWTs, apply for loans, repay them, and admins approve or reject pending applications. Data lives in **PostgreSQL** (via **Prisma**); paginated loan reads are cached with **Redis** and an in-memory LRU tier.

For deeper rationale (assumptions, trade-offs, future work), see [DECISIONS.md](./DECISIONS.md).

---

## Features

- **Authentication** — Register (customers only), login, logout, and `GET /auth/me` with JWT bearer tokens; server-side token rows support revocation and version invalidation.
- **Loans** — Apply (`PENDING`), admin process (`ACTIVE` or `REJECTED`), customer repayments with history; list loans with pagination (customer sees own loans; admin sees all).
- **Financial integrity** — Critical paths use Prisma **Serializable** transactions; approval credits the user balance atomically with loan updates.
- **Concurrency** — Database partial unique index enforces at most one `PENDING` or `ACTIVE` loan per user.
- **Caching** — Loan list responses cached per user/role/page; cache invalidated on apply, process, and repay.

---

## Tech stack

| Layer | Choice |
|--------|--------|
| Runtime | Node.js |
| Framework | [NestJS](https://nestjs.com/) 11 |
| ORM | [Prisma](https://www.prisma.io/) 7 (`@prisma/adapter-pg`) |
| Database | PostgreSQL 17 |
| Cache | `@nestjs/cache-manager` + [Keyv](https://github.com/jaredwray/keyv) (memory LRU + Redis) |
| Validation | `class-validator` / `class-transformer` |
| Security | `helmet`, `cors`, `bcrypt` |

---

## Prerequisites

- **Node.js** (LTS recommended)
- **pnpm** — pinned in `package.json` (`packageManager` field); install globally or via Corepack.
- **PostgreSQL** and **Redis** — locally, via Docker Compose, or a hosted provider.

---

## Project structure (high level)

```
src/
  app.module.ts          # Root module
  main.ts                # Bootstrap: helmet, CORS, global ValidationPipe
  auth/                  # Registration, login, logout, profile
  users/                 # User domain services (no separate public CRUD controller in tree)
  loans/                 # Loan controllers, services, DTOs, state machine
  prisma/                # PrismaService + generated client under prisma/generated
  common/                # Guards (JWT + roles), decorators, shared types
  appjwt/                # JWT module wiring
prisma/
  schema.prisma          # Merged schema (see schema workflow below)
  schemas/*.prisma       # Split schema fragments merged by script
  migrations/            # SQL migrations
scripts/
  merge-schema.ts        # Merge split Prisma schemas into prisma/schema.prisma
```

---

## Environment variables

Copy `.env.sample` to `.env` and fill in values.

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default commonly `3000`) |
| `DIRECT_DATABASE_URL` | PostgreSQL connection string used by the app runtime **and** `prisma.config.ts` for migrations |
| `JWT_SECRET` | Secret for signing access tokens |
| `JWT_EXPIRES_IN` | Access token lifetime (e.g. `60m`) |
| `REDIS_URL` | Redis connection URL for cache store and direct Redis client (cache invalidation) |
| `REDIS_TTL` | Cache TTL in milliseconds (numeric string; sample uses `60_000`) |
| `REDIS_LRU_SIZE` | In-memory LRU store size before Redis |
| `NODE_ENV` | Set to `production` in production (affects trust proxy); `test` uses `TEST_DATABASE_URL` in `PrismaService` |
| `TEST_DATABASE_URL` | Optional: used when `NODE_ENV=test` |

Docker Compose also expects `POSTGRES_*`, `PGADMIN_*`, and port mapping via `PORT` — see [docker-compose.yml](./docker-compose.yml).

**Example `DIRECT_DATABASE_URL` for Compose** (app service → Postgres service):

`postgresql://POSTGRES_USER:POSTGRES_PASSWORD@postgres:5432/POSTGRES_DB`

For host-machine Prisma CLI against the exposed DB: use `localhost:5432` instead of `postgres`.

---

## Local development

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start PostgreSQL and Redis

Use your own instances or:

```bash
docker compose up -d postgres redis
```

### 3. Configure `.env`

Set `DIRECT_DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`, and TTL-related variables.

### 4. Prisma migrate

```bash
pnpm run prisma:migrate
```

(`package.json` runs `dotenv -e .env prisma migrate dev`.)

### 5. Generate Prisma client (if needed)

```bash
pnpm exec prisma generate
```

### 6. Run the API

```bash
pnpm run start:dev
```

The server listens on `PORT` from `.env`.

---

## Docker Compose (full stack)

The [docker-compose.yml](./docker-compose.yml) defines:

| Service | Role |
|---------|------|
| `gtmb_app` | Nest app (dev image target), `pnpm run start:dev`, code mounted from host |
| `postgres` | PostgreSQL 17 Alpine, data in `db_data` volume |
| `redis` | Redis 7 with AOF |
| `pg_admin` | pgAdmin 4 on port **5050** (credentials from env) |

From the repo root:

```bash
docker compose up --build
```

Ensure `.env` contains URLs reachable **from inside the app container** (e.g. `postgres` hostname, not `localhost`).

---

## Prisma schema workflow

Split files live under `prisma/schemas/` (`user`, `loan`, `repayment`, `token`). The merged file consumed by Prisma is **`prisma/schema.prisma`**.

```bash
# Preview merge without writing
pnpm run schema:merge:dry-run

# Merge with backup + validation (see script for flags)
pnpm run schema:merge
```

After editing split schemas, merge, then create or apply migrations as usual.

---

## API reference

Base URL: `http://localhost:<PORT>` (no global prefix).

### Auth (`/auth`)

| Method | Path | Auth | Description |
|--------|------|------|----------------|
| `POST` | `/auth/register` | Public | Register; `role` must be `CUSTOMER` (admins are not self-registered). |
| `POST` | `/auth/login` | Public | Login; returns JWT and persists session metadata. |
| `POST` | `/auth/logout` | Bearer | Revokes current session token. |
| `GET` | `/auth/me` | Bearer | Returns `id`, `email`, `role`. |

**Register body** (`RegisterDto`): `name`, `email`, `password` (8–16 chars), `role` = `CUSTOMER`.

**Login body** (`LoginDto`): `email`, `password` (8–16 chars).

### Loans (`/loans`)

All routes require `Authorization: Bearer <access_token>`.

| Method | Path | Role | Description |
|--------|------|------|---------------|
| `POST` | `/loans` | `CUSTOMER` | Apply for a loan. |
| `PATCH` | `/loans/:id` | `ADMIN` | Approve or reject a **pending** loan. |
| `POST` | `/loans/:id/repay` | `CUSTOMER` | Record a repayment toward own loan. |
| `GET` | `/loans` | Both | Paginated list: customers see own loans; admins see all. |

**Query params** (`GET /loans`): `page` (default 1), `limit` (default 10, max 100).

**Apply body** (`ApplyLoanDto`):

- `amount` — number, max 2 decimal places, **minimum 1000**
- `durationInMonths` — integer **1–60**

**Process body** (`ProcessLoanDto`) — admin only:

- `status` — **`approved`** or **`rejected`** (lowercase strings; maps to `ACTIVE` / `REJECTED` in storage)
- `note` — optional string, max 500 characters

**Repay body** (`RepayLoanDto`):

- `amount` — number, max 2 decimal places, **minimum 1000** (amounts are capped to outstanding balance in service logic)

---

## Loan lifecycle

```
PENDING ──(admin approved)──► ACTIVE ──(repay until zero)──► COMPLETED
   │
   └──(admin rejected)──► REJECTED
```

Enforced in code via `LoanStateMachine` and in the database via a partial unique index on `user_id` where `status IN ('ACTIVE','PENDING')`.

**Domain notes** (see [DECISIONS.md](./DECISIONS.md)):

- No interest accrual; outstanding balance tracks principal-style amounts.
- Currency is stored as decimal fields without FX.
- Overpayment is capped to the outstanding balance.

---

## NPM scripts

| Script | Purpose |
|--------|---------|
| `pnpm run start` | Start Nest once |
| `pnpm run start:dev` | Watch mode |
| `pnpm run start:prod` | Run compiled `dist/main` |
| `pnpm run build` | `nest build` |
| `pnpm run lint` | ESLint (with fix) |
| `pnpm run format` | Prettier |
| `pnpm run test` | Unit tests (Jest, `src/**/*.spec.ts`) |
| `pnpm run test:e2e` | E2E tests (`test/jest-e2e.json`) |
| `pnpm run test:cov` | Coverage |
| `pnpm run prisma:migrate` | Load `.env` and run `prisma migrate dev` |
| `pnpm run schema:merge*` | Schema merge helpers (see [package.json](./package.json)) |
| `pnpm run seed:data` / `seed:data:cleanup` | Documented seed entrypoints (implement or restore `scripts/seed.data.ts` if missing) |

---

## Testing

```bash
pnpm run test
pnpm run test:e2e
```

For tests that hit the database, set `NODE_ENV=test` and `TEST_DATABASE_URL` per `PrismaService`.

---

## Production build (Docker)

The [Dockerfile](./Dockerfile) uses a multi-stage build: **development** stage installs deps and builds; **production** copies `dist` and installs production dependencies only. Override `NODE_ENV` and supply production-grade secrets, Redis, and Postgres URLs.

---

## Security notes

- JWTs are sent as **Bearer** tokens; guard verifies JWT and checks token row + `tokenVersion` against the user.
- Helmet and strict `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`) are enabled globally.
- CORS is configured with `credentials: true` and `origin: '*' ` in code — tighten `origin` for production deployments.

---

## License

`UNLICENSED` (see [package.json](./package.json)).
