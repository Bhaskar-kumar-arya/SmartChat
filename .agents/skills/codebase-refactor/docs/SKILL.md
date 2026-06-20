---
name: docs
description: |
  Produces architecture documentation from a finalized TypeScript codebase. Use when the
  orchestrator assigns a Stage 5 documentation task. Reads barrel files, interfaces,
  the DI container (if any), and audit.md, then produces three documents: ADR.md, modules.md,
  and ai-context.md. The ai-context.md must be under 100 lines — it is prepended to
  future AI prompts. Triggers on phrases like "generate architecture docs", "document
  the architecture", "create the ADR", or when the orchestrator hands off a Stage 5
  worker prompt.
version: 2.0.0
tags:
  - documentation
  - architecture
  - typescript
---

# Architecture Documentation Worker

You are a stateless worker. You receive the finalized codebase after all refactoring
phases are complete. Your job is to produce three architecture documents and report back.

These documents are not for posterity — they are working artifacts:
- `ADR.md` explains why the architecture is the way it is (prevents future re-debates)
- `modules.md` maps every module's public boundary (prevents accidental cross-coupling)
- `ai-context.md` is a dense summary prepended to every future AI prompt about this codebase
  (prevents AI agents from suggesting patterns that violate the established architecture)

---

## Pre-Flight

Read these files before writing anything:

1. All `index.ts` barrel files in `src/` — these define public module boundaries
2. All interface files (`I*.ts`) — these define the contracts between modules
3. The DI container file (if one exists) — this defines the full dependency graph
4. `audit.md` — this contains the history of what was changed and why (ADR source material)
5. `package.json` — for stack/framework details

Build a complete picture before writing a single document.

---

## Document 1: `docs/architecture/ADR.md`

Architecture Decision Records — one entry per major architectural decision.

Source material: audit.md violation descriptions + fix rationale, plus your reading of
the current codebase structure.

### ADR generation algorithm

For each Phase marked `[x]` in audit.md, generate one or more ADR entries covering:
- The violation(s) that existed before the change
- The pattern that was applied to fix it
- The constraints it introduces going forward

### ADR entry format

```markdown
## ADR-N: [Decision Title]

**Date:** [approximate — based on audit.md]
**Status:** Accepted

### Context
[What problem existed? What was painful or risky about the old approach?
2-4 sentences. Be specific — name the files or patterns that were problematic.]

### Decision
[What was chosen? Name the pattern: Repository Pattern, Strategy Registry,
Event Bus Abstraction, CQRS, ISP split, etc.]

### Consequences
**Enables:**
- [What is now possible or easier?]

**Constrains:**
- [What must now be respected to preserve this decision?]
- [What would break this decision if ignored?]

**Watch for:**
- [Common ways this decision gets eroded over time]
```

See `references/adr-template.md` for a worked example.

---

## Document 2: `docs/architecture/modules.md`

A boundary map for every feature domain.

### Module entry format

```markdown
## `services/<domain>/`

**Purpose:** [One sentence — what this module owns]

**Public exports** (`index.ts`):
- `IServiceName` — [what it does]
- `IRepositoryName` — [what it does]
- `DomainType`, `OtherType` — shared types

**Internal only** (never import from outside this folder):
- `ConcreteService.ts`
- `ConcreteRepository.ts`
- `helpers/`, `parsers/`, etc.

**Consumes from other modules:**
- `services/<other>/` — `IInterfaceName` for [purpose]

**Consumed by:**
- `services/<consumer>/` — uses `IInterfaceName`
```

### Coverage requirement

Every folder under `src/` must have an entry. If a folder has no `index.ts`, note that
its exports are not yet formalized (this is a smell to flag).

---

## Document 3: `docs/architecture/ai-context.md`

A compact file prepended to future AI prompts. **Hard limit: 100 lines.**

This file must be dense and scannable — not prose. Use tables and bullet lists.
Every line must earn its place. Cut anything an AI could infer from context.

### Required sections

```markdown
# [Project Name] — AI Context File

## Stack
[Stack description] | [Structure type] | [Key infrastructure]

## Key Patterns
| Pattern | Where | Rule |
|---|---|---|
| [Pattern name] | [File pattern] | [One-sentence enforcement rule] |

## Hard Constraints
- [Constraint 1 — what must never be done]
- [Constraint 2]

## Module Map
| Module | Public Interface | Owned By |
|---|---|---|
| [module name] | [exported interfaces] | [concrete class(es)] |

## Extension Points
| To add... | Do this |
|---|---|
| [New variant/feature] | [Exact steps — what file to create, where to register] |

## What NOT to do
- [Anti-pattern 1 — specific to this codebase]
- [Anti-pattern 2]
```

**After writing:** Count the lines. If over 100, cut the least useful rows from the
module map or merge similar extension points.

---

## Quality Rules

**ADR.md:**
- Every "Constrains" entry must be a concrete prohibition a developer could check for
- Every "Watch for" entry must be a real erosion pattern seen in the original codebase
- No ADR should be shorter than 8 lines — if it is, the context and consequences are incomplete

**modules.md:**
- "Internal only" section must be accurate — verify by checking what index.ts exports
- "Consumed by" must be verified by running grep, not guessed
- If a module has no index.ts, explicitly flag it

**ai-context.md:**
- Must be under 100 lines — non-negotiable
- Every table row must reflect actual current state of the codebase
- Extension points must be real, working patterns — not aspirational

---

## Verification

After generating all three documents:

```bash
# Verify all files exist
# Verify ai-context.md is under 100 lines

# If the project has tests, read package.json and run them
# to confirm documentation generation didn't break anything
npm run typecheck
```

---

## Required Report Format

```
## Architecture Docs Report

Files created:
  - docs/architecture/ADR.md
  - docs/architecture/modules.md
  - docs/architecture/ai-context.md

ADR decisions documented: N
  [list titles]

Modules mapped: N
  [list module names]

ai-context.md line count: N [must be ≤ 100]

Modules without index.ts (unformalized boundaries):
  [list or "none"]

Blockers: [any issues]
```

## Reference Files

- `references/adr-template.md` — Worked example of a well-written ADR entry
- `references/module-template.md` — Worked example of a module boundary entry