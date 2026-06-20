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
<Generate phases dynamically based on your audit findings. Include only phases that
apply to this codebase. Use the reference template below as a starting point, but
add, remove, or rename phases as needed. Number them sequentially.>
- [ ] Phase 1: ...
- [ ] Phase 2: ...
...
```

**Phase generation rules:**
- Include only phases that address violations you actually found
- Order phases so that earlier phases have no dependency on later ones
- Low-effort phases go before high-effort phases when dependency order allows
- Each phase must be completable independently once prior phases are done
- 3-12 phases is the typical range

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

**Determine which phases apply using this decision tree:**

| Question | If YES → include phase |
|---|---|
| Are there shared types files > 200 lines or monolithic type definitions? | Types & Constants phase |
| Are there fat interfaces (8+ methods) with consumers using different subsets? | Interface Segregation phase |
| Are there concrete event bus / message broker imports in services? | Communication Infrastructure phase |
| Are there leaf services with DIP violations (no interface, direct DB imports)? | Leaf Services phase |
| Are there mid-level services with SRP / OCP violations? | Domain Services phase |
| Are there complex orchestrators / controllers with multiple responsibilities? | Pipeline Orchestrators phase |
| Does the project have a DI container mapping to concrete classes? | Composition Root phase |

**Reference template** (adapt as needed — do not copy verbatim if phases don't apply):

```markdown
## Phase N: [Phase Title]
**Objective:** [One sentence describing what this phase achieves]
**Files in scope:** [exhaustive list]
**What changes:**
- [Specific change 1]
- [Specific change 2]
**Verification:** `npm run typecheck` returns zero errors
```

**Common phase archetypes** (use as inspiration, not a fixed list):

1. **Common Types and Constants** — Segregate monolithic type/constant definitions so layers import only what they need
2. **Core Data/Infrastructure Abstraction** — Split bloated interfaces for database, network, or filesystem operations (ISP)
3. **Shared Communication Infrastructure** — Abstract event buses, message brokers, or notification systems behind interfaces
4. **Leaf Services / Utilities** — Refactor low-level independent services with no internal domain dependencies (SRP + DIP)
5. **Domain Services** — Refactor mid-level business services (SRP + OCP + DIP)
6. **High-Level Pipeline Orchestrators** — Refactor complex workflow coordinators and controllers
7. **Composition Root / DI Wiring** — Map DI keys to abstract interfaces instead of concrete classes

Skip any archetype that has no violations in this codebase. Add custom phases for
violation patterns not covered above.

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