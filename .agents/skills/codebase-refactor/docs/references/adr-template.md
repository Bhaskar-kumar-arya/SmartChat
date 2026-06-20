# ADR Template — Worked Example

This is a reference example showing how a well-written ADR entry should look.
Adapt the structure and level of detail for your project.

---

## ADR-1: Repository Pattern for Data Access

**Date:** 2026-06-15
**Status:** Accepted

### Context
Several service classes directly imported the ORM client (`PrismaClient`) and made
database calls inline alongside business logic. This meant:
- Unit testing required a live database or complex mocking
- Changing the ORM would require touching every service file
- Business logic was tangled with query construction, making it hard to reason about

Key violators: `UserService.ts` (12 direct Prisma calls), `OrderService.ts` (8 calls).

### Decision
Introduce the **Repository Pattern**: each domain gets a dedicated `*Repository.ts` file
that owns all database operations. Services depend on an `IRepository` interface, never
on the ORM client directly. The DI container wires the concrete repository to the interface.

### Consequences
**Enables:**
- Services are unit-testable with a mock repository (no DB required)
- ORM can be swapped by implementing new repository classes, zero service changes
- Database queries are centralized and optimizable per-domain

**Constrains:**
- Service files must NEVER import the ORM client directly
- All database calls must live in `*Repository.ts` files only
- Repository interfaces must be narrowly scoped (no god-repository)

**Watch for:**
- "Just one quick query" in a service file — starts the erosion back toward tight coupling
- Repository interfaces growing to 15+ methods — signals ISP violation, should be split
