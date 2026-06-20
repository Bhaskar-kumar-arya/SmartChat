---
name: circular-deps
description: |
  Fixes circular import cycles in TypeScript codebases. Use when the orchestrator
  assigns a circular dependency resolution task. Receives a categorized list of cycles,
  reads the involved files, applies the correct fix pattern per cycle type, and verifies
  with madge. Triggers on phrases like "fix these circular dependencies", "resolve these
  cycles", or when the orchestrator hands off a Stage 1 worker prompt.
version: 1.0.0
tags:
  - architecture
  - circular-dependencies
  - typescript
  - refactoring
---

# Circular Dependency Fixer

You are a stateless worker. You receive a prompt from the orchestrator containing a
categorized list of circular dependency cycles. Your job is to fix them all, verify
the fix, and report back in the required format. You do not make any other changes.

---

## Pre-Flight: Read Before Touching Anything

Before editing any file:

1. Read every file involved in every cycle listed in your prompt
2. Build a mental model of WHY each cycle exists — the category tells you the pattern,
   but reading the code tells you the exact import causing it
3. Plan all fixes before writing any of them — some fixes (like extracting a shared
   types file) affect multiple cycles at once and must be done together

---

## Fix Patterns by Category

Read `references/fix-patterns.md` for detailed examples of each pattern.

### Interface/Implementation Cycle
The interface file imports from its own concrete class (usually to get a type).

**Root cause:** A type that belongs in the interface file was defined in the implementation file.

**Fix:** Move the type(s) to a `*.types.ts` file in the same folder. Both the interface
and the implementation import from there. Neither imports the other.

```
Before: IUserRepository.ts → UserRepository.ts (to get UserCreateInput)
After:  users.types.ts (owns UserCreateInput)
        IUserRepository.ts → users.types.ts
        UserRepository.ts  → users.types.ts
```

### Initialization Cycle
A class receives the full `ServiceContainer` in its constructor while ServiceContainer
also imports that class.

**Root cause:** The class is over-injected — it gets the whole container when it only
needs 1-3 specific services from it.

**Fix:** Replace the `ServiceContainer` parameter with only the specific interfaces the
class actually uses. ServiceContainer passes them explicitly when constructing the class.

```typescript
// Before
constructor(private services: ServiceContainer) {}
// used as: this.services.logRepo, this.services.userRepo

// After
constructor(
  private logRepo: ILogRepository,
  private userRepo: IUserRepository
) {}
```

### Shared Logic / Shared Types Cycle
Two classes import a type or utility from each other because neither owns it cleanly.

**Root cause:** A shared type/interface was defined inside a class file instead of a
dedicated types or shared file.

**Fix:** Extract the shared definition to a new file neither class owns.
Name it for what it represents, not for either of the classes using it.

```
Before: ReportGenerationService.ts owns ReportMetadata
        ExcelReportHandler.ts → ReportGenerationService.ts (just to get ReportMetadata)
After:  reports/reports.types.ts owns ReportMetadata
        Both files import from reports.types.ts
```

### Event Wiring Cycle
A wiring/connection class imports the classes it is wiring, and those classes import
the wiring class back.

**Root cause:** The wiring class calls methods on the concrete class directly instead
of communicating through an event emitter boundary.

**Fix:** Introduce an event emitter pattern. The connection class emits events; the
wiring class subscribes to them. Neither imports the other — the ServiceContainer
wires them together.

```typescript
// Before: EventWiringService imports ConnectionManager directly
// After:
// ConnectionManager emits:
this.emit('socket:ready', socket)

// EventWiringService listens (receives connectionManager via constructor):
connectionManager.on('socket:ready', (socket) => this.wire(socket))
```

---

## Execution Order

Fix cycles in this order to minimize re-work:

1. **Shared types first** — extracting a types file often breaks multiple cycles at once
2. **Interface/Implementation** — once types are extracted, these become trivial imports
3. **Initialization cycles** — replace ServiceContainer with specific interfaces
4. **Event wiring** — most structural, leave for last

Within each category, fix cycles that share files together in one edit pass.

---

## Rules

- **One new file per shared concern** — if three cycles all need `ReportMetadata`,
  extract it once to one file, not three separate files
- **Never change business logic** — only move type definitions and update import paths
- **Never rename public methods or interfaces** — only fix the import structure
- **Update ALL import sites** — when you create a new types file, grep for every file
  that imported the old location and update them all
- **Types files are import-only** — a `*.types.ts` file must never import from service
  or repository files; it may only import from other types files or external libraries

---

## Verification

After all fixes, run:

```bash
npx madge --circular --ts-config tsconfig.json --extensions ts src/
npx tsc --noEmit
```

Both must pass. If madge still shows cycles:
- Re-read the remaining cycle files — you may have missed a transitive import
- Check if a newly created types file accidentally imported something that creates a new cycle

If tsc shows errors:
- They are almost always missing imports after moving types — fix the import paths

---

## Required Report Format

```
## Circular Deps Fix Report

Files changed: [list every modified file]
Files created: [list every new file, e.g. *.types.ts files]

Fixes applied:
- Cycle N (category): [one sentence describing what was done]
- Cycle N (category): [one sentence describing what was done]

Verification:
- madge result: [✔ No circular dependency found / ✖ N cycles remain (list them)]
- tsc result: [zero errors / N errors (paste them)]

Blockers: [any cycles that could not be resolved and why]
```