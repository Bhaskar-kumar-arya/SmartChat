---
name: feature-and-bugfix
description: |
  Enforces strict type safety, SOLID principles, DRY principles, clean folder structures, and layered boundaries
  when implementing new features or fixing bugs. Contains mandatory pre-flight analysis and concrete guard-rails
  designed to prevent monolith growth, type pollution, and silent error swallowing before they ever accumulate.
  Also acts as an architecture guardian — if the codebase has been refactored with established patterns,
  this skill prevents new work from regressing those patterns.
version: 3.0.0
tags:
  - development
  - feature-implementation
  - bug-fix
  - architecture
  - regression-prevention
---

# Feature & Bugfix Guidelines

## Overview

This skill defines **preventive** rules and mandatory analysis steps that must be performed *before writing a single line of code*. The goal is to prevent architectural debt from accumulating in the first place — not just to clean it up afterward.

> [!CAUTION]
> **YOU MUST COMPLETE THE PRE-FLIGHT ANALYSIS (Section 1) BEFORE WRITING ANY CODE.**
> Skipping or rushing this phase is the primary cause of monolith growth, type pollution, and refactors.
> Failure to comply is unacceptable.

---

## Section 1 — Mandatory Pre-Flight Analysis

Before touching any file, run through this checklist in order. Do not skip steps.

### Step 1.1 — Discover Existing Architecture

Before making any change, check whether the codebase has established architectural patterns:

1. **Check for `docs/architecture/ai-context.md`** — if this file exists, read it first. It contains
   the project's key patterns, hard constraints, module map, and extension points. Your changes
   must respect everything documented there.
2. **Check for `audit.md`** — if this file exists, read the phase tracker to understand what
   refactoring has already been done. Do not re-introduce violations that were fixed.
3. **Check for barrel files (`index.ts`)** — if they exist, understand what they export and
   respect the public/private boundary they establish.
4. **Check for a DI container** — if one exists, understand how dependencies are wired and
   follow the established injection pattern.

If none of these files exist, proceed with general best practices from Section 2 onward.

### Step 1.2 — Identify the Blast Radius

Answer these questions before making any change:

1. **Which files will I touch?** List every file that must change.
2. **Which files *should* I touch but the task doesn't ask me to?** If a directly related file already violates SRP, flag it and split it *in the same session*.
3. **Will any touched file grow by more than ~50 lines?** If yes, a split is mandatory (see Section 2).
4. **Am I adding a new responsibility to an existing class/module?** If yes, extract it into its own file.

### Step 1.3 — Classify the Change

Identify which architectural layer the change belongs to:

| Layer | Examples | Must NOT touch |
|---|---|---|
| **Infrastructure** | DB queries, file system, sockets, external API clients | Business logic, UI |
| **Domain / Service** | Business rules, workflows, orchestration | Raw DB clients, `fs`, sockets directly |
| **Presentation** | UI components, IPC handlers, API controllers, response formatters | DB, `fs`, domain internals |

If your change touches *more than one layer in the same file*, you must split the file first.

### Step 1.4 — Pre-Code Architectural Decision

Before writing implementation code, explicitly decide:

- **Pattern:** Will this use event-driven pub/sub, repository pattern, strategy pattern, a factory, or something else? Pick the most decoupled, testable pattern — not the quickest one.
- **New file(s) needed?** Prefer creating a new, focused file over expanding an existing one.
- **Interface first:** Define or reuse an interface/type for all inputs and outputs before writing the implementation body.

---

## Section 2 — File Size & SRP Guard-Rails

These are hard thresholds. When any threshold is breached, splitting is **mandatory and must happen in the same session, not deferred**.

| Threshold | Action Required |
|---|---|
| A file exceeds **300 lines** | Split into focused sub-modules |
| A file exceeds **200 lines** *and* your change adds significant new code | Split before adding new code |
| A function/method exceeds **40 lines** | Extract sub-functions with single purposes |
| A class has **more than 3 public methods** doing unrelated things | Split into separate classes |
| A file imports from **more than 2 architectural layers** | Restructure — wrong layer dependency |

### Splitting Strategy

When splitting a file, follow this structure within the same feature domain folder:

```
services/<domain>/
  <Domain>Repository.ts   ← ONLY DB/storage statements (reads, writes, deletes)
  <Domain>Parser.ts       ← ONLY pure parsing/mapping of raw external payloads
  <Domain>Enricher.ts     ← ONLY display/formatting logic (aliases, names, previews)
  <Domain>Service.ts      ← ONLY orchestration — imports the above, no DB/fs directly
```

**Key rule:** A `*Service.ts` file must NEVER directly contain DB statements, `fs` calls, or raw socket/HTTP operations. Those belong in a `*Repository.ts` or dedicated adapter file.

### When to Create a Sub-Folder

A sub-folder is warranted when a *group of related files* shares a cohesive sub-concern within the domain. Do not create sub-folders prematurely — only when the threshold is clearly met.

| Trigger | Action |
|---|---|
| 3 or more files share the same sub-concern (e.g., all are formatters, all are validators) | Extract them into a named sub-folder |
| A single file implementing a strategy/plugin grows into multiple variants | Move all variants into a sub-folder with a shared interface |
| A sub-folder would contain only 1–2 files | Do **not** create it — keep files flat in the domain folder |

**Sub-folder structure example:**

```
services/<domain>/
  <Domain>Service.ts
  <Domain>Repository.ts
  formatters/                  ← sub-folder: 3+ formatter variants exist
    index.ts                   ← exports only the interface + registry, not each class
    <Domain>Formatter.ts       ← shared interface / base type
    TypeAFormatter.ts
    TypeBFormatter.ts
    TypeCFormatter.ts
  validators/                  ← sub-folder: 3+ validator variants exist
    index.ts
    <Domain>Validator.ts
    TypeAValidator.ts
```

**Sub-folder rules:**
- The `index.ts` inside a sub-folder must export **only the interface and the registry/resolver function** — never each concrete class individually. Callers depend on the abstraction, not the implementations.
- Sub-folders must not cross domain boundaries. A `formatters/` folder under `orders/` must not import from `users/`.
- Maximum nesting depth is **2 levels** below `src/` (e.g., `services/orders/formatters/`). Deeper nesting is a sign the domain itself needs to be split.

---

## Section 3 — Strict Type Safety (Zero Tolerance)

### 3.1 Forbidden Patterns

The following are **absolutely forbidden** with no exceptions:

```typescript
// ❌ NEVER — bypasses compiler safety
const x = something as any;
const y: any = value;
function foo(x: any) {}

// ❌ NEVER — hides runtime failures silently
promise.catch(() => {});
try { ... } catch (e) {}        // empty catch
try { ... } catch (_e) {}       // suppressed catch
```

### 3.2 Required Replacements

```typescript
// ✅ For unknown external payloads (e.g., third-party API responses):
function isExpectedShape(payload: unknown): payload is MyType {
  return !!payload && typeof payload === 'object' && 'id' in payload;
}

// ✅ For optional chaining instead of non-null assertions:
const name = user?.profile?.displayName ?? 'Anonymous';   // not user!.profile!.displayName

// ✅ For error handling — ALWAYS log and preserve the error:
promise.catch((err: unknown) => {
  logger.error('[ContextName] operationName failed:', err);
});

try {
  await riskyOperation();
} catch (err: unknown) {
  logger.error('[ContextName] riskyOperation failed:', err);
  throw err;  // or handle explicitly — never silently discard
}
```

### 3.3 Typing External Library Payloads

When working with third-party library types that are partially `unknown`:

1. **Import the library's own types first.** Check if the library already exports a proper type before declaring your own.
2. **Declare a narrowed local interface** for exactly the fields you use — do not import the widest possible type and cast it.
3. **Use runtime type guards** at the boundary where external data enters the system. All internal code beyond that boundary should use fully typed values.

---

## Section 4 — Error Handling Rules

Every error surface must be accounted for. No exceptions.

### 4.1 Structured Logging

All error logs must include a `[ContextName]` prefix for traceability:

```typescript
logger.error('[OrderService] checkout failed:', err);
```

### 4.2 Error Propagation Strategy

Choose one explicitly — do not mix randomly:

| Strategy | When to use |
|---|---|
| **Re-throw** | The caller needs to know the operation failed |
| **Log + return fallback** | The failure is non-critical; the system can continue |
| **Log + structured error result** | The caller needs to distinguish success from failure |

Never choose "ignore" as a strategy.

### 4.3 Promise Chains

Prefer `async/await` over raw `.then().catch()` chains to make error paths explicit and linear.

---

## Section 5 — SOLID Principles (Applied Concretely)

### Single Responsibility (SRP)
- One file = one reason to change.
- If you can describe a file's purpose using the word "and" (e.g., "it parses requests *and* saves them to the DB"), it needs to be split.

### Open/Closed (OCP)
- Adding a new type, provider, or formatter must NOT require editing existing switch/if-else chains.
- Use a **registry or strategy pattern**:

```typescript
// Define the interface once
export interface PayloadFormatter {
  supports(type: string): boolean;
  format(content: unknown): string;
}

// Register implementations — never modify the registry consumer to add new types
const formatters: PayloadFormatter[] = [
  new JsonFormatter(),
  new CsvFormatter(),
  new XmlFormatter(),
];

// Usage — closed to modification, open to extension
const formatter = formatters.find(f => f.supports(payloadType));
```

### Liskov Substitution (LSP)
- Favor composition over inheritance. If you create a subclass, it must be fully substitutable for the parent without altering behavior.

### Interface Segregation (ISP)
- Keep interfaces small and specific. A `UserRepository` should not expose formatting or notification methods.
- If a consumer only uses 2 of 8 methods on a class, the interface is too wide — split it.

### Dependency Inversion (DIP)
- Services must depend on **interfaces**, not concrete implementations.
- Inject dependencies via constructor, not by instantiating them inside the class body:

```typescript
// ✅ Correct — injected, testable, swappable
class OrderService {
  constructor(
    private readonly repo: IOrderRepository,
    private readonly mailer: IMailer,
  ) {}
}

// ❌ Wrong — tight coupling, impossible to test or swap
class OrderService {
  private repo = new OrderRepository();
  private mailer = new SmtpMailer();
}
```

---

## Section 6 — Architecture Regression Prevention

This section prevents re-introducing problems that a refactoring pipeline would fix.
Even if the codebase has never been formally refactored, these patterns prevent debt accumulation.

### 6.1 — Barrel File Discipline

If the codebase uses `index.ts` barrel files:
- **Never export concrete classes** through a barrel — only interfaces and types
- **Never import from a module's internal files** if that module has a barrel — use the barrel
- When creating new files in a module with a barrel, add the public interface to the barrel

### 6.2 — Interface-Driven Dependencies

- When adding a new dependency between services, always create or use an interface
- A service file must never `import { ConcreteClass } from '../other-module/ConcreteClass'`
- The correct pattern: `import { IInterfaceName } from '../other-module'` (through the barrel)

### 6.3 — DI Container Respect

If the project has a DI container:
- Never call `new ConcreteClass()` inside a service class body
- New services must be instantiated in the DI container and injected via constructor
- Never import the DI container inside a service — only the DI container imports services

### 6.4 — Strategy/Registry Patterns

If the codebase uses strategy registries for extensibility:
- Adding a new variant = create a new file + register it
- Never add a new `case` to an existing `switch` or a new `if-else` branch
- Check the extension points documented in `ai-context.md` (if it exists)

### 6.5 — Layer Boundary Enforcement

| Layer | Files Belong Here | Must NOT Import |
|---|---|---|
| **Infrastructure** | `*Repository.ts`, `*Adapter.ts`, storage clients | Domain services, UI/transport |
| **Domain / Service** | `*Service.ts`, `*Handler.ts`, `*Workflow.ts` | Raw DB clients, `fs`, sockets directly |
| **Presentation / Transport** | Controllers, route handlers, IPC bridges, UI components | Domain internals, DB clients directly |

---

## Section 7 — Folder & File Organization

### Preferred Structure (Feature-Domain Based)

```
src/
  services/
    orders/
      OrderRepository.ts    ← Infrastructure: DB only
      OrderParser.ts        ← Domain: pure data transformation
      OrderEnricher.ts      ← Presentation: display formatting
      OrderService.ts       ← Domain: orchestration
    users/
      UserRepository.ts
      UserService.ts
  adapters/
    LocalFileStorage.ts     ← fs operations isolated here, nowhere else
    HttpClient.ts           ← external HTTP calls isolated here
  controllers/              ← or ipc/ or api/ — transport layer only, no business logic
    OrderController.ts
```

### Barrel Files

- Use `index.ts` to export only **public interfaces** of a module.
- Never re-export concrete implementations through a barrel — only types and interfaces.
- Do not create circular `index.ts` imports.

---

## Section 8 — Documentation Maintenance

As the codebase evolves, documentation must remain a source of truth. If your feature or bugfix introduces new files, dependencies, public interfaces, or architectural choices, you must update the documentation in the same session:

### 8.1 — Update `docs/architecture/modules.md` (Module Map)
You must update this file if you:
- Create a new directory under `src/` (add its purpose, exports, internals, and imports).
- Add new files or interfaces to an existing directory (update **Internal only** or **Public exports** list).
- Change dependencies between directories (update **Consumes from** or **Consumed by** lists).

### 8.2 — Update `docs/architecture/ai-context.md` (AI Context)
You must update this file if you:
- Introduce a new core design pattern, hard constraint, or extension point.
- Add or modify a major module that other parts of the application consume (update the **Module Map** table).
- Remember to keep the file **under 100 lines** total.

### 8.3 — Update `docs/architecture/ADR.md` (Decision Records)
You must update this file if you:
- Make a significant architectural choice (e.g., introducing a new external library, switching a global communication pattern, changing the data caching strategy).
- Create a new entry using the standard ADR format: Date, Status, Context, Decision, Consequences (Enables, Constrains, Watch for).

---

## Section 9 — Implementation Rules

### 9.1 No Speculative Code (YAGNI)
- Only implement what the active task requires.
- Do not add "future-proof" abstractions, optional parameters, or hooks that nothing currently uses.

### 9.2 Root Cause, Not Patch
- Never wrap a buggy path in a generic `try-catch` to hide the symptom.
- Use `console.log` / `console.error` liberally during debugging to trace actual values, then remove them once the root cause is confirmed.

### 9.3 Design Pattern Fit
- Before implementing, consider whether an event-driven, queue-based, state machine, pub/sub, or repository pattern fits better than a direct call chain.
- The easiest implementation path is often the worst architectural choice.

---

## Section 10 — End-of-Session Checklist (part of the Task artifact)

Before ending any session where code was written, verify all of the following:

- [ ] **Zero `any` types** introduced — grep for `as any` and `: any` to confirm.
- [ ] **Zero empty catch blocks** — grep for `.catch(() => {})` and empty `catch` bodies to confirm.
- [ ] **No file grew past 300 lines** without being split in the same session.
- [ ] **No new cross-layer imports** (e.g., a Service importing a DB client directly, a Repository containing business logic).
- [ ] **All new functions have explicit return types** declared.
- [ ] **TypeScript compiles with zero errors** (`npm run typecheck`).
- [ ] **All new classes use constructor injection** for dependencies.
- [ ] **Every new public interface is in a dedicated `.ts` type file** or barrel — not inline in implementation files.
- [ ] **No barrel file exports concrete classes** — only interfaces and types.
- [ ] **No regression of established patterns** — if `ai-context.md` documents constraints, verify none were violated.
- [ ] **Documentation updated** — if any files, public interfaces, dependencies, or architectural decisions were added/modified, `modules.md`, `ai-context.md`, or `ADR.md` have been updated accordingly.
- [ ] **Tests pass** — read `package.json` to discover the test command and run it. Report the result.

> [!IMPORTANT]
> If ANY item in this checklist is not green, do not end the session. Fix the violation before submitting.

---

## Section 11 — Anti-Patterns That Cause Massive Refactors

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
| Importing concrete classes across module boundaries | Defeats the purpose of interfaces and makes swapping impossible |
| Exporting concrete classes from barrel files | Consumers couple to implementations instead of abstractions |