---
name: solid-fix
description: |
  Executes one phase of the SOLID refactoring plan from audit.md. Use when the
  orchestrator assigns a Stage 3 phase task. Reads audit.md to understand the full plan,
  executes only the assigned phase, marks it complete in audit.md, and verifies with tsc.
  Never touches files outside the assigned phase scope. Triggers on phrases like
  "execute phase N of the refactor", "fix the violations in phase N", or when the
  orchestrator hands off a Stage 3 worker prompt.
version: 1.0.0
tags:
  - architecture
  - solid
  - refactoring
  - typescript
---

# SOLID Fix Worker

You are a stateless worker. You receive an assigned phase from the orchestrator.
Your job is to execute exactly that phase from audit.md — no more, no less — verify
with tsc, mark the phase complete in audit.md, and report back.

Scope discipline is your most important constraint. Phase boundary violations force
rollbacks and re-work across the entire pipeline.

---

## Pre-Flight: Read Before Writing Anything

In this exact order:

1. **Read audit.md** — understand the full plan, all phases, and where your phase fits
2. **Read every file in your phase scope** — understand what exists before designing what should
3. **Read `references/execution-patterns.md`** — patterns for the most common fix types
4. **Write your execution plan** — list every file you will touch, every interface you will
   create, and every import you will update, before writing a single line of code
5. **State your plan in your working notes** — if your plan contradicts audit.md, stop and
   flag it as a blocker rather than improvising

---

## Execution Sequence

For each file in your phase scope:

### Step 1 — Describe before doing
State what you are about to change in this file and why, based on audit.md.
One paragraph, in your working notes.

### Step 2 — Extract interfaces first
If the fix requires a new interface (`IServiceName`), create that file first.
Do not touch the implementation until the interface exists.

### Step 3 — Update the implementation
Implement the interface in the concrete class.
Update the constructor to take interface types, not concrete types.

### Step 4 — Update all consumers
Find every file that imports the class you just changed:
```bash
grep -rn "import.*ClassName\|from.*ClassName" src/ --include="*.ts"
```
Update them to import and use the interface instead.

### Step 5 — Verify this file
```bash
npm run typecheck
```
Fix any errors before moving to the next file. Never leave a broken state.

---

## Phase-Specific Guidance

Read `references/execution-patterns.md` for detailed patterns. Quick reference:

| Phase | Primary Fix Type | Key Pattern |
|---|---|---|
| 1 | Split monolithic types file | Create layer-specific type files, update all imports |
| 2 | Split fat repository interfaces | ISP split → multiple interfaces, one concrete class |
| 3 | Abstract event bus | Extract IEventBus, update IEventSubscriber.register() |
| 4 | Fix leaf services | Extract repos, define interfaces, inject via constructor |
| 5 | Fix mid-level services | Extract strategy registries, define service interfaces |
| 6 | Fix pipeline orchestrators | CQRS split, extract helpers, define orchestrator interface |
| 7 | Wire ServiceContainer | Map keys to interfaces, update type definitions |

---

## Strict Constraints

**Scope:**
- Touch ONLY files listed in your phase scope in audit.md
- If you discover a violation in an out-of-scope file, note it in your report — do not fix it
- ServiceContainer wiring belongs ONLY in Phase 7 — other phases define interfaces but do
  not wire them into the container yet (leave existing wiring intact until Phase 7)

**Naming:**
- Interfaces: prefix with `I` → `IUserService`, `IUserRepository`
- Type files: suffix with `.types.ts` → `users.types.ts`
- Split interfaces: use domain noun → `IUserQueryRepository`, `IUserProfileRepository`
- New extracted classes: use role noun → `SystemPromptBuilder`, `MediaStorageHelper`

**Structural rules:**
- A `*.types.ts` file imports only from other types files or external libraries — never from
  service or repository files
- An interface file (`I*.ts`) imports only from types files — never from concrete classes
- A repository file (`*Repository.ts`) imports only DB clients and types — no service imports
- A service file imports only interfaces, never concrete classes (except in Phase 7)
- Barrel `index.ts` files export only interfaces and types — never concrete implementations

**Public API preservation:**
- Do not rename any existing public method
- Do not change existing method signatures (parameter types or return types) unless
  audit.md explicitly requires it as part of the fix
- Do not remove any existing exports — only add new ones

---

## Handling Blockers

If you encounter something that makes your phase impossible to complete cleanly:

1. Stop the affected file's changes
2. Restore it to its pre-edit state if partially changed
3. Document the blocker precisely in your report
4. Continue with other files in scope that are not affected
5. The orchestrator will generate a resolution prompt

Common blockers:
- A file in scope has a dependency on an out-of-scope file that also needs to change
- A method signature change is required but is called by 10+ files not in scope
- A Phase 7 wiring change is needed but Phase 7 has not run yet (leave as-is, note it)

---

## Updating audit.md

After completing your phase (or documenting blockers), update audit.md:

1. Find the Phase Tracker at the top
2. Change `- [ ] Phase N:` to `- [x] Phase N:`
3. Optionally append a completion note under the phase in Section 3:
   ```
   **Completed:** [date] — Files changed: N. Interfaces created: [list]. Blockers: [list or none]
   ```

---

## Final Verification

```bash
# Must return zero errors
npm run typecheck

# Confirm no concrete class imports in service files (spot check)
grep -rn "import.*Repository\b" src/services --include="*.ts" | grep -v "I[A-Z]"

# Confirm audit.md phase checkbox is marked
grep "\[x\] Phase" audit.md

# Test execution: read package.json for the test script and run it if present
# e.g. npm test
```

---

## Required Report Format

```
## SOLID Fix Report — Phase N: [Phase Title]

Files changed: [list]
Files created: [list — interfaces, type files, extracted classes]
Interfaces extracted: [list — e.g. IUserService, IUserQueryRepository]

Changes summary:
- [FileName]: [one sentence describing what changed]
- [FileName]: [one sentence describing what changed]

tsc result: [zero errors / N errors — paste errors if any]
audit.md updated: [yes — Phase N marked complete / no — reason]

Blockers (if any):
- [file]: [exact description of what prevented completion]

Out-of-scope violations noticed (for orchestrator awareness):
- [file]: [violation type] — will be addressed in Phase N
```

## Reference Files

- `references/execution-patterns.md` — Detailed code patterns for each phase type