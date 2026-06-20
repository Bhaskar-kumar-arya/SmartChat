---
name: solid-audit
description: |
  Reads a TypeScript codebase and produces audit.md — a comprehensive SOLID violation
  report and phase-wise refactoring plan. Use when the orchestrator assigns a Stage 2
  audit task. Reads the top fan-in files, evaluates each SOLID principle per file,
  proposes no-code fixes, and organizes everything into a prioritized phase plan.
  Triggers on phrases like "audit the codebase for SOLID violations", "generate the
  audit file", or when the orchestrator hands off a Stage 2 worker prompt.
version: 1.0.0
tags:
  - architecture
  - solid
  - audit
  - typescript
---

# SOLID Audit Worker

You are a stateless worker. You receive a list of files ranked by fan-in. Your job is
to read every file, diagnose SOLID violations with precision, and produce `audit.md` —
the shared artifact that all Stage 3 refactoring workers will use.

This file must be thorough enough that a worker reading only audit.md (without reading
the source files) fully understands what to change and why. No hand-waving.

---

## Pre-Flight

Before writing anything:

1. Read every file in the fan-in list provided by the orchestrator
2. Also read the `ServiceContainer` — it reveals the full dependency graph
3. Read `references/solid-principles.md` for evaluation criteria
4. Build a complete picture of the codebase before diagnosing any single file

Do not diagnose in isolation. A class that looks bloated may be fine if its dependencies
are clean. A class that looks small may be a DIP violation if it instantiates its deps.

---

## Audit Process Per File

For each file, work through this sequence:

### Step 1 — Responsibilities
List every distinct thing the file does. Be specific. Not "handles users" but:
- "Parses raw external JSON payloads into domain types"
- "Inserts parsed users into the database via ORM"
- "Emits user:created events on the EventBus"

If you need the word "and" to connect two things in one bullet, they are two responsibilities.

### Step 2 — SOLID Evaluation
Evaluate each principle. Be binary: **PASS** or **VIOLATION**. Use **N/A** only for
principles genuinely not applicable (e.g. LSP for a file with no inheritance).

Read `references/solid-principles.md` for what constitutes a violation vs a pass.

### Step 3 — Violation Detail
For each VIOLATION:
- State which principle
- Quote or describe the exact symptom in the code (method name, import, pattern)
- Propose the fix at the design level — no code, just the target design
- Score effort: Low (type/import changes only) / Medium (extract 1-2 classes) / High (restructure pipeline)

---

## audit.md Structure

Write audit.md with exactly these three sections in this order.

### Section 1: Phase Completion Tracker

Put this at the very top so workers can find it immediately.

```markdown
# Refactor Audit — [App Name]

## Phase Tracker
- [ ] Phase 1: Shared Types Segregation
- [ ] Phase 2: Repository Interface Segregation
- [ ] Phase 3: Event Bus Abstraction
- [ ] Phase 4: Leaf Services
- [ ] Phase 5: Mid-Level Services
- [ ] Phase 6: Pipeline Orchestrators
- [ ] Phase 7: ServiceContainer Wiring
```

### Section 2: Per-File Violation Report

One entry per file. Use this exact template:

```markdown
## `path/to/File.ts`
Fan-in: N

**Responsibilities**
1. ...
2. ...

**SOLID Evaluation**
| Principle | Result | Notes |
|---|---|---|
| SRP | VIOLATION | File has 4 distinct responsibilities |
| OCP | PASS | |
| LSP | N/A | No inheritance |
| ISP | VIOLATION | Interface exposes 12 methods; consumers use 2-3 each |
| DIP | VIOLATION | Imports concrete DB client directly |

**Violations**

### SRP — [Short label]
Symptom: [exact description — method names, what it does that it shouldn't]
Fix: [target design — what classes/files should exist after the fix]
Effort: Medium

### ISP — [Short label]
Symptom: ...
Fix: ...
Effort: Low
```

### Section 3: Phase-Wise Refactoring Plan

Organize all violations into phases. Each phase groups files whose fixes have the same
dependency profile — i.e., fixing them together doesn't require any other phase to be
done first.

Standard phase order:

```markdown
## Phase 1: Shared Types Segregation
**Objective:** Remove the monolithic types file(s) that every layer imports.
**Files in scope:** [list]
**What changes:**
- Split types.ts into layer-specific files: dtos/types.ts, domain/types.ts, infra/types.ts
- Split EventTypes.ts into individual sub-event type files + index barrel
- Update all import paths across the codebase
**Verification:** `npx tsc --noEmit` returns zero errors

## Phase 2: Repository Interface Segregation
**Objective:** Split fat repository interfaces so consumers only depend on what they use.
**Files in scope:** [list]
**What changes:**
- IUserRepository → IUserRepository + IUserProfileRepository + IUserSessionRepository
- IOrderRepository → IOrderRepository + IOrderHistoryRepository
- IInvoiceRepository → IInvoiceRepository + IInvoiceHistoryRepository
- Concrete repository classes implement the segregated interfaces
**Verification:** `npx tsc --noEmit` returns zero errors

## Phase 3: Event Bus Abstraction
**Objective:** Decouple all event-driven services from the concrete EventBus class.
**Files in scope:** [list]
**What changes:**
- Extract IEventBus interface (on, off, emit, removeAllListeners)
- Update IEventSubscriber.register(bus) parameter type to IEventBus
- Wire concrete bus to interface in ServiceContainer
**Verification:** `npx tsc --noEmit` returns zero errors

## Phase 4: Leaf Services
**Objective:** Fix SRP and DIP in leaf-level services (no other services depend on them).
**Files in scope:** [list — determined by your fan-in analysis]
**What changes:** [specific to your audit findings]
**Verification:** `npx tsc --noEmit` returns zero errors

## Phase 5: Mid-Level Services
**Objective:** Fix SRP, OCP, and DIP in mid-level orchestrators.
**Files in scope:** [list]
**What changes:** [specific to your audit findings]
**Verification:** `npx tsc --noEmit` returns zero errors

## Phase 6: Pipeline Orchestrators
**Objective:** Refactor the highest-complexity coordinators (e.g. OrderService).
**Files in scope:** [list]
**What changes:** [specific to your audit findings]
**Verification:** `npx tsc --noEmit` returns zero errors

## Phase 7: ServiceContainer Wiring
**Objective:** Bind all container keys to interface types, not concrete classes.
**Files in scope:** [ServiceContainer.ts]
**What changes:**
- Update type definition: keys map to interfaces (IOrderService, IUserService, etc.)
- Update createServices to wire concrete classes to their interfaces
- Verify all consumer code uses interface types, not concrete class types
**Verification:** `npx tsc --noEmit` returns zero errors
```

---

## Quality Rules for audit.md

- **No vague fixes.** "Refactor this class" is not a fix. "Extract DB client calls into
  a new `IInvoiceRepository` interface; inject it via constructor" is a fix.
- **No code in the fix descriptions.** Describe the target design. Workers write the code.
- **Every violation must map to exactly one phase.** No violation should appear in two phases.
- **Phase scope lists must be exhaustive.** A worker must be able to execute their phase
  knowing only audit.md — they should never need to guess which files are in scope.
- **Fan-in files go first in Section 2.** Preserve the ranking order from the orchestrator.
- **Effort scores drive phase assignment.** High-effort files go later in the phase order
  so earlier phases de-risk the codebase before the hardest work begins.

---

## Required Report Format

```
## Solid Audit Report

audit.md path: [full path]
Files audited: [count]
Violations found: [count]
  - SRP: N
  - OCP: N
  - LSP: N
  - ISP: N
  - DIP: N
Phases planned: [count]
Effort breakdown:
  - Low: N files
  - Medium: N files
  - High: N files
Blockers: [any files that could not be read or analyzed]
```

## Reference Files

- `references/solid-principles.md` — Precise pass/fail criteria for each SOLID principle