# DECISIONS.md — Key Technical Decisions

## Architecture

### NestJS Modular Design

The application is split into three feature modules — `AuthModule`, `UsersModule`, and `LoansModule` — each with clear boundaries. This mirrors domain-driven design principles and makes the codebase easy to navigate, test, and extend independently.

### PostgreSQL + TypeORM

PostgreSQL was chosen for its ACID guarantees, which are non-negotiable for financial data. TypeORM with `synchronize: true` (only in non-production) is used for rapid development while keeping the schema in sync with entities. In a production system, this would be replaced with versioned migrations.

### Redis for Caching

Redis is used to cache paginated loan list responses per user per page, with a 5-minute TTL. This reduces database load on frequently accessed read endpoints. Cache keys are scoped by user ID and role so admins and users never share stale data. Cache is invalidated on every mutation (apply, process, repay) via explicit key deletion.

### Database Transactions

Loan approval and repayment operations use TypeORM's `DataSource.transaction()` to ensure atomicity. For example, when approving a loan, both the loan status update and the user balance credit happen within the same transaction — if either fails, the entire operation is rolled back. This prevents partial state corruption.

---

## Assumptions

- **Currency is stored as a prisma decimal** (no currency conversion) in the `balance` and loan `amount` columns. In production, I would use integer amounts in the smallest currency unit (kobo) to avoid floating-point precision issues.
- **No interest is calculated.** The outstanding balance equals the original loan amount. A real system would include interest rate logic, amortisation schedules, and scheduled jobs.
- **One active loan constraint** covers `PENDING`, `APPROVED`, and `ACTIVE` statuses. A user must fully repay or be rejected before applying again.
- **Repayment caps at outstanding balance.** If a user overpays, the excess is silently capped. In production this would return a clear error or handle refunds.
- **Admins are created via seeding only.** There is no admin registration endpoint to prevent privilege escalation.

---

## Trade-offs

### `synchronize: true` vs Migrations

I used prisma migrations because it's very easy to set up and works well with NestJS & TypeScript.

### Cache Invalidation Strategy

The current approach deletes specific cache keys by pattern after mutations. A more robust strategy would use cache tags or an event-driven invalidation approach (e.g., Redis pub/sub or a message queue), especially in a horizontally-scaled deployment.

### JWT-only Auth (No Refresh Tokens)

Only access tokens are implemented. In production, refresh tokens stored in an httpOnly cookie with rotation would be needed to provide uninterupted session amd also improve session security.

### No Rate Limiting

No rate limiting is applied to the loan application or login endpoints. In production, `@nestjs/throttler` with Redis backing would prevent brute-force and spam attacks.

---

## What I Would Improve With More Time

1. **Comprehensive test suite** — unit tests for services with mocked repositories and integration tests for controllers using an in-memory SQLite database.
2. **Swagger/OpenAPI documentation** using `@nestjs/swagger` for self-documenting, interactive API docs.
3. **Observability** — structured logging (e.g., Pino), distributed tracing (e.g., OpenTelemetry), and health check endpoints.
4. **Refresh token rotation** for improved auth security.
5. **Rate limiting** configuration for API protection.
6. **Add Transaction retries** for when transactions conflict and they rollback. Final note: because you are using Serializable, you should still add retry logic for Prisma transaction errors like P2034. That is not because your logic is wrong; it is how serializable concurrency control tells you: “rerun this safely.”
