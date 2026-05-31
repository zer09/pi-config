# Intent Node Examples

## Root node: monorepo

```markdown
# Platform

Monorepo containing payment, billing, and user services.

## Architecture

platform/
├── services/          # Microservices, each with own DB
├── packages/          # Shared libraries
├── platform-config/   # Runtime configuration
└── scripts/           # Build and deploy tooling

## Key Invariants

- Services communicate via message queue, never direct HTTP
- All config lives in `platform-config/`, never hardcoded
- Shared types in `packages/types/`; all services import from there

## Anti-patterns

- Never import between services directly
- Do not put business logic in `packages/`; utilities only

## Related Context

- Payment service: `services/payment/AGENTS.md`
- Billing service: `services/billing/AGENTS.md`
```

## Child node: service

```markdown
# Payment Service

Owns payment lifecycle: initiation -> validation -> processing -> settlement.
Does NOT own invoicing; see billing-service.

## Entry Points

- `src/api/` - REST endpoints, internal only via API gateway
- `src/workers/` - Background job processors

## Contracts

- All processor calls go through `src/clients/processor-client.ts`
- Idempotency keys required for all payment mutations

## Patterns

Adding a new payment method:
1. Add type to `src/types/payment-method.ts`
2. Implement adapter in `src/adapters/`
3. Register in `src/adapters/index.ts`

## Anti-patterns

- Never bypass `processor-client.ts` for external calls
- Do not store card numbers; use tokenization only

## Pitfalls

- `src/legacy/` looks deprecated but handles edge cases for pre-2023 accounts
```

## Compression example

### Before, verbose

```markdown
# User Service

## Overview

The User Service is a microservice that is responsible for managing user accounts
in our platform. It handles user registration, authentication, profile management,
and user preferences. This service is built using TypeScript and Express.js, and
it uses PostgreSQL as its database through Prisma ORM.

## Technologies Used

- TypeScript 5.0
- Express.js 4.x
- PostgreSQL 15
...
```

### After, compressed

```markdown
# User Service

Manages user accounts, auth, and preferences. Express + Prisma + PostgreSQL.

## Entry Points

- `src/routes/` - REST API
- `src/jobs/` - Background sync tasks

## Contracts

- Auth tokens come from `packages/auth/`
- User events publish to `events.users.*`

## Anti-patterns

- Never store passwords; use `packages/auth/hash.ts`
- Do not query the users table directly from other services; use events
```

## Key principles

1. Purpose before structure: state ownership and non-ownership.
2. Contracts are explicit: name the required path, API, or invariant.
3. Anti-patterns come from experience: document real mistakes to avoid.
4. Compression over explanation: assume the agent is smart.
5. Downlinks for depth: point to related context instead of duplicating it.
