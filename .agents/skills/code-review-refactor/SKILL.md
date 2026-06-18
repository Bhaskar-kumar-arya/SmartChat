---
name: code-review-refactor
description: |
  Enforces clean code architecture, SOLID principles, strict type safety,
  proper file/folder organization, and sound software design patterns during code review and refactoring.
  Use when analyzing project structures, introducing new components, refactoring legacy code, or auditing type systems.
version: 2.0.0
tags:
  - architecture
  - solid
  - typesafety
  - clean-code
---

# Code Review & Refactoring Guidelines

## Overview

This skill defines a **mandatory, structured audit workflow** for reviewing and refactoring code. The goal is not only to identify existing violations but to produce a prioritized, phased remediation plan that eliminates the root causes of technical debt — preventing future large-scale refactors.

> [!CAUTION]
> **YOU MUST COMPLETE THE FULL AUDIT (Sections 1–2) BEFORE PROPOSING ANY CHANGES.**
> Do not jump straight to writing code. Surface all violations first, classify their severity, then produce a phased plan.

---

## Section 1 — Audit Scope & Entry Point

Before reviewing any code, define the audit scope explicitly:

1. **Which files/folders are in scope?** List them.
2. **What triggered this review?** (New feature integration, bug investigation, size threshold breach, routine audit, etc.)
3. **What layers does this code touch?** Infrastructure / Domain / Presentation — or multiple?

Then run the following audits in order.

---

## Section 2 — Violation Detection Checklist

Work through each category and record every violation found. Do not fix anything yet — audit first, fix second.

### 2.1 — SRP & File Cohesion Audit

Run through each file in scope and flag:

| Signal | Severity |
|---|---|
| File exceeds **300 lines** | 🔴 Critical |
| File exceeds **200 lines** and has multiple unrelated concerns | 🟠 High |
| A function/method exceeds **40 lines** | 🟠 High |
| A class has more than **3 public methods** doing unrelated things | 🟠 High |
| A file's purpose requires the word "and" to describe (e.g., parses *and* saves, renders *and* fetches) | 🟠 High |
| A Service file directly contains DB queries or raw I/O operations | 🔴 Critical |
| A general `utils.ts` or `helpers.ts` has grown beyond a single concern | 🟡 Medium |
| Business logic lives inside a controller, route handler, or IPC handler | 🔴 Critical |
| 3+ files in a domain folder share a sub-concern but are not grouped into a sub-folder | 🟡 Medium |
| A sub-folder exists with only 1–2 files (premature nesting) | 🟡 Medium |
| Folder nesting exceeds 2 levels below `src/` | 🟠 High |

### 2.2 — Type Safety Audit

Grep the files in scope for the following patterns and record every occurrence:

```
as any
: any
catch (() => {})
catch (_e) {}
catch (e) {}    ← with empty body
!.              ← non-null assertion
```

| Pattern | Severity |
|---|---|
| `as any` or `: any` | 🔴 Critical |
| Non-null assertion (`!.`) | 🟠 High |
| Empty catch block | 🔴 Critical |
| `.catch(() => {})` silent swallow | 🔴 Critical |
| Missing return types on public functions | 🟡 Medium |
| `unknown` used without a type guard narrowing it | 🟡 Medium |

### 2.3 — Layer Boundary Audit

For each file, check its import statements and flag:

| Violation | Severity |
|---|---|
| A Service file imports a DB client or ORM directly | 🔴 Critical |
| A Repository file contains business logic or event bus calls | 🔴 Critical |
| A UI/Renderer file imports from server/main-process modules | 🔴 Critical |
| A Domain file imports raw I/O libraries (`fs`, `path`, sockets, HTTP clients) directly | 🔴 Critical |
| A file imports from more than **2 architectural layers** | 🟠 High |
| A class instantiates its own dependencies (`new X()` inside the body) instead of receiving them via constructor | 🟠 High |

**Standard architectural layers:**

| Layer | Files Belong Here | Must NOT Import |
|---|---|---|
| **Infrastructure** | `*Repository.ts`, `*Adapter.ts`, storage clients | Domain services, UI/transport |
| **Domain / Service** | `*Service.ts`, `*Handler.ts`, `*Workflow.ts` | Raw DB clients, `fs`, sockets directly |
| **Presentation / Transport** | Controllers, route handlers, IPC bridges, UI components | Domain internals, DB clients directly |

### 2.4 — OCP / Extensibility Audit

Flag the following patterns:

| Pattern | Severity |
|---|---|
| A `switch` or `if-else` chain that must be modified to add a new type / provider / format | 🟠 High |
| A hardcoded list of types or strategies inside a core service | 🟠 High |
| Adding a new variant requires editing more than **1 existing file** | 🟠 High |
| No interface/abstraction exists for something with multiple (or future) implementations | 🟡 Medium |

### 2.5 — Dependency Injection Audit

| Pattern | Severity |
|---|---|
| `private dep = new ConcreteClass()` inside a class body | 🔴 Critical |
| Class constructor takes no parameters but uses external services internally | 🔴 Critical |
| No interface defined for an injected dependency | 🟡 Medium |

---

## Section 3 — Phased Refactoring Plan Output

After the audit, produce a refactoring plan in this exact structure. Do not collapse all work into a single phase.

### Phase 1 — Type Safety & Error Visibility (Immediate, No Structural Risk)
- Replace all `as any` / `: any` with proper types or `unknown` + type guards.
- Replace all empty `.catch(() => {})` with logged error handlers using a `[ContextName]` prefix.
- Add missing return types to all public functions.
- Replace all `!.` non-null assertions with `?.` optional chaining + `??` fallbacks.

**Why first:** These changes are low-risk (no structural movement), immediately improve runtime safety, and unblock accurate analysis of structural issues in Phase 2.

---

### Phase 2 — SRP Decoupling & File Splitting (Medium Risk, High Impact)
- Split every file flagged in the SRP audit.
- Each split must follow the layered structure:
  ```
  services/<domain>/
    *Repository.ts   ← DB/storage only
    *Parser.ts       ← pure data transformation, no side effects
    *Enricher.ts     ← display/formatting logic
    *Service.ts      ← orchestration only, imports the above
    *Adapter.ts      ← raw I/O (fs, sockets, external APIs)
  ```
- Move business logic out of controllers, route handlers, and IPC bridges.
- Introduce constructor injection wherever a class instantiates its own dependencies.

#### Sub-Folder Rules (apply during this phase)

Create a sub-folder **only** when all three conditions are met:
1. **3 or more files** share the same sub-concern within a domain (e.g., all are formatters, all are validators, all are event handlers).
2. The sub-concern has a **clear, single name** that describes all of them.
3. The sub-folder would not cross domain boundaries.

```
services/<domain>/
  <Domain>Service.ts
  <Domain>Repository.ts
  formatters/               ← created only when 3+ formatters exist
    index.ts                ← exports ONLY the interface + resolver fn, not each class
    <Domain>Formatter.ts    ← shared interface / base type
    TypeAFormatter.ts
    TypeBFormatter.ts
    TypeCFormatter.ts
```

- The `index.ts` inside a sub-folder must export **only the shared interface and registry/resolver** — never re-export each concrete class. Callers depend on the abstraction.
- **Maximum nesting depth: 2 levels** below `src/` (e.g., `services/orders/formatters/`). Deeper nesting signals the domain itself needs to be split into separate top-level domains.
- Do **not** create a sub-folder for 1–2 files — keep them flat in the domain folder.

**Why second:** Requires Phase 1 to be complete so types are clean before files are restructured.

---

### Phase 3 — OCP & Extensibility (Lower Risk, Future-Proofing)
- Replace hardcoded `switch`/`if-else` type chains with a **strategy registry pattern**:
  ```typescript
  export interface ItemHandler {
    supports(type: string): boolean;
    handle(payload: unknown): void;
  }

  // Registry — closed to modification, open to extension
  const handlers: ItemHandler[] = [
    new TypeAHandler(),
    new TypeBHandler(),
    new TypeCHandler(),
  ];

  export function resolveHandler(type: string): ItemHandler | undefined {
    return handlers.find(h => h.supports(type));
  }
  ```
- Define interfaces for all services that have or will have multiple implementations.
- Register strategies in a dedicated registry file — never inline in a service.

**Why third:** Requires clean types (Phase 1) and correct structure (Phase 2) before abstraction layers are meaningful.

---

## Section 4 — Required Replacement Patterns

### 4.1 — Type Safety

```typescript
// ❌ FORBIDDEN
const data = rawPayload as any;
function process(input: any) {}

// ✅ REQUIRED — narrow unknown at the system boundary
function isExpectedShape(payload: unknown): payload is MyType {
  return !!payload && typeof payload === 'object' && 'id' in payload;
}
```

```typescript
// ❌ FORBIDDEN
const value = obj!.property;

// ✅ REQUIRED
const value = obj?.property ?? defaultValue;
```

### 4.2 — Error Handling

```typescript
// ❌ FORBIDDEN — silently discards failures
await operation().catch(() => {});
try { await op(); } catch (e) {}

// ✅ REQUIRED — always log with context prefix
await operation().catch((err: unknown) => {
  logger.error('[ServiceName] operationName failed:', err);
});

try {
  await riskyOperation();
} catch (err: unknown) {
  logger.error('[ServiceName] riskyOperation failed:', err);
  throw err; // or handle explicitly
}
```

### 4.3 — Dependency Injection

```typescript
// ❌ FORBIDDEN — tight coupling, untestable
class OrderService {
  private repo = new OrderRepository();
  private mailer = new SmtpMailer();
}

// ✅ REQUIRED — injected, testable, swappable
class OrderService {
  constructor(
    private readonly repo: IOrderRepository,
    private readonly mailer: IMailer,
  ) {}
}
```

### 4.4 — Layer Boundaries

```typescript
// ❌ FORBIDDEN — Service importing a DB client directly
import { db } from '@/db/client';
class UserService {
  async save(user: User) {
    await db.user.upsert({ ... }); // ← belongs in a Repository
  }
}

// ✅ REQUIRED — Service delegates to Repository
class UserService {
  constructor(private readonly repo: IUserRepository) {}
  async save(user: User): Promise<void> {
    await this.repo.upsert(user);
  }
}
```

---

## Section 5 — Post-Refactor Verification Checklist(part of the Task artifact)

After every refactoring session, verify all of the following before closing:

- [ ] **Zero `any` types** — grep confirms no `as any` or `: any` remains in changed files.
- [ ] **Zero empty catches** — grep confirms no `.catch(() => {})` or empty `catch` bodies remain.
- [ ] **No file exceeds 300 lines** — all splits are complete and happened in the same session.
- [ ] **No Service file imports a DB client, `fs`, or raw I/O libraries directly.**
- [ ] **All dependencies are injected via constructor**, not instantiated inside the class body.
- [ ] **All new public functions have explicit return types.**
- [ ] **TypeScript compiles with zero errors** (`tsc --noEmit` or `npm run build`).
- [ ] **All new strategies/handlers are registered in a registry file**, not inlined in a service.
- [ ] **All barrel `index.ts` files export only interfaces/types**, not concrete implementations.
- [ ] **The phased plan is updated** to reflect what was done and what remains.

> [!IMPORTANT]
> If ANY item above is not green, the session is not complete. Fix the violation before finalizing.

---

## Section 6 — Anti-Patterns That Cause Massive Refactors

These are the exact patterns that lead to large-scale, painful refactors. Flag them immediately and never introduce them:

| Anti-Pattern | Why It's Dangerous |
|---|---|
| God file / God function (500+ lines, multiple concerns) | Impossible to unit-test, change, or reason about in isolation |
| `as any` on third-party payloads | Runtime crashes when external schemas change; no compile-time guard |
| `.catch(() => {})` everywhere | Failures are invisible; bugs accumulate silently |
| Business logic in controllers or transport handlers | Can't be tested, reused, or decoupled from the transport layer |
| Direct DB client in a Service layer | Swapping DB or mocking for tests becomes a full rewrite |
| Hardcoded type `if-else` chains | Every new type requires touching and risking multiple existing files |
| `new Dependency()` inside class body | Impossible to inject mocks or swap implementations |
| Mixing layers in one file | One change cascades into unrelated concerns; no clean boundaries |