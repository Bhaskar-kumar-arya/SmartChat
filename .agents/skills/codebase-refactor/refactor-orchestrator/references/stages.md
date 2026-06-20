# Stages Reference

Full specification for every stage, including step sequences, commands to run, and worker prompt templates.

---

## Stage 0 — Boot

**Purpose:** Explore the codebase and build the project context block used in all subsequent worker prompts.

**Run these commands yourself (no worker needed):**

```bash
# 1. Get a structural overview
find src/ -type f -name "*.ts" | sort | head -80

# 2. Check stack and scripts
cat package.json

# 3. Read tsconfig
cat tsconfig.json

# 4. Find the ServiceContainer
find src/ -name "ServiceContainer.ts" -o -name "container.ts" | head -5

# 5. Identify entry points
ls src/
```

**Output:** Populated project context block. Advance immediately to Stage 1.

---

## Stage 1 — Circular Dependency Resolution

**Purpose:** Eliminate all circular imports before any structural work begins.
Circular deps mean cluster boundaries are wrong — fixing them first ensures Stage 3
workers don't refactor across broken module lines.

### Step 1.1 — Detect

Run yourself:
```bash
npx madge --circular --ts-config tsconfig.json --extensions ts src/
```

If output is `✔ No circular dependency found` → Stage 1 complete, skip to Stage 2.

If cycles found → proceed to Step 1.2.

### Step 1.2 — Categorize and generate worker prompt

Analyze the cycles yourself. Classify each into one of:
- **Interface/Implementation** — interface imports its own concrete class
- **Initialization** — class receives full ServiceContainer instead of specific deps
- **Shared logic** — two classes share a type/util that belongs in a third file
- **Event wiring** — wiring class imports classes it wires, creating a loop
- **Others** 

Then generate this worker prompt:

```
=== PROJECT CONTEXT ===
<project context block>
=== END CONTEXT ===

## Objective
Fix all circular dependencies in the codebase. Do not refactor anything else.

## Skill to use
circular-deps

## Circular dependencies to fix
<paste the madge output>

## Categorization
<your analysis of each cycle and its category>

## Fix strategy per category
- Interface/Implementation: move shared types to a *.types.ts file in the same folder
- Initialization: inject only specific needed services, not the full ServiceContainer
- Shared logic: extract shared type/util to a new shared file neither class owns
- Event wiring: introduce an event emitter boundary; wiring class subscribes, never imports
- Others : work accordingly

## Constraints
- Do not change any business logic
- Do not rename any public methods or interfaces
- Do not touch files outside the cycles listed above

## Verification contract
Run `npx madge --circular --ts-config tsconfig.json --extensions ts src/` — must return 0 cycles
Run `npx tsc --noEmit` — must return zero errors

## Required report format
- Files changed: [list]
- Files created: [list]
- Verification: [madge result] [tsc result]
- Blockers: [any issues]
```

### Step 1.3 — Verify

When worker reports back, run yourself:
```bash
npx madge --circular --ts-config tsconfig.json --extensions ts src/
npx tsc --noEmit
```

Both must pass. If not, generate a targeted fix prompt identifying the remaining cycles.

**Stage 1 complete when:** madge returns 0 cycles AND tsc returns 0 errors.

---

## Stage 2 — SOLID Audit

**Purpose:** Produce `audit.md` — the shared artifact that guides all of Stage 3.
This file contains: every violation found, no-code-level proposed fixes, and the phase-wise plan.
All Stage 3 workers will read and update this file.

### Step 2.1 — Fan-in analysis

Run yourself:
```bash
npx madge --json --ts-config tsconfig.json --extensions ts src/ | node -e "
const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
const fanIn = {};
for (const [file, deps] of Object.entries(data)) {
  for (const dep of deps) {
    fanIn[dep] = (fanIn[dep] || 0) + 1;
  }
}
Object.entries(fanIn)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 25)
  .forEach(([f, count]) => console.log(count, f));
"
```

### Step 2.2 — Generate audit worker prompt

```
=== PROJECT CONTEXT ===
<project context block>
=== END CONTEXT ===

## Objective
Produce a comprehensive SOLID audit of the codebase and write it to audit.md.
This file will be the single source of truth for all refactoring phases that follow.

## Skill to use
solid-audit

## Files to audit (ranked by fan-in — highest impact first)
<paste fan-in output — top 25 files>

## What audit.md must contain

### Section 1: Per-file violation table
For each file:
- File path
- Distinct responsibilities (numbered list)
- SOLID evaluation: PASS / VIOLATION / N/A per principle
- For each VIOLATION: which principle, exact symptom, proposed fix (no code — describe target design)
- Effort score: Low / Medium / High

### Section 2: Phase-wise refactoring plan
Organize all fixes into phases. Each phase must:
- Have a title and objective
- List exact files in scope
- Describe what changes (no code)
- State what verification command confirms it is complete
- Have a status field: [ ] TODO

Standard phase order (adjust if your analysis suggests otherwise):
- Phase 1: Shared types segregation (types.ts, event types)
- Phase 2: Repository interface segregation (fat interfaces → split ISP)
- Phase 3: Core event infrastructure (event bus abstraction)
- Phase 4: Leaf services (e.g. EncryptionService, LoggingService, ConfigService)
- Phase 5: Mid-level services (e.g. UserService, PaymentService, InventoryService)
- Phase 6: High-level pipeline orchestrators (e.g. OrderProcessingService, AuthPipelineService)
- Phase 7: ServiceContainer wiring (bind keys to interfaces not concrete classes)

### Section 3: Phase completion tracker
A checklist at the top of the file:
- [ ] Phase 1
- [ ] Phase 2
... etc

## Constraints
- Do not change any code
- This is a diagnosis and plan only
- No-code fixes mean: describe the target design, not the implementation

## Verification contract
audit.md must exist at <project root>/audit.md
It must contain all three sections above
Every file in the fan-in list must appear in Section 1

## Required report format
- audit.md path: [path]
- Files audited: [count]
- Violations found: [count]
- Phases planned: [count]
- Blockers: [any issues]
```

### Step 2.3 — Verify

Read `audit.md` yourself. Confirm:
- All top fan-in files are covered
- Each phase has a clear scope and verification command
- Phase tracker checklist exists at top

**Stage 2 complete when:** audit.md exists and passes the above checks.

---

## Stage 4a — Type Safety Smells (Pre-Structural)

**Purpose:** Fix type-safety and async-safety issues before structural refactoring begins.
These are safe to fix with zero structural changes and mean Stage 3 workers operate on cleaner code.

### Step 4a.1 — Detect

Run yourself:
```bash
# as any / : any
grep -rn "as any\|: any" src/ --include="*.ts" | grep -v node_modules | grep -v ".d.ts"

# Non-null assertions
grep -rn "!\." src/ --include="*.ts" | grep -v node_modules | grep -v ".d.ts"

# Empty catches
grep -rn "catch\s*(.*)\s*{}" src/ --include="*.ts" | grep -v node_modules
grep -rn "\.catch(() => {})" src/ --include="*.ts" | grep -v node_modules

# Floating promises (common patterns)
grep -rn "^\s*[a-zA-Z].*\.(then|catch)\(" src/ --include="*.ts" | grep -v "return\|await\|const\|let\|var" | grep -v node_modules

# Missing awaits on async calls inside async functions (heuristic)
grep -rn "async\|await" src/ --include="*.ts" | grep -v node_modules | grep -v ".d.ts" | head -40
```

Tally counts per file. Rank files by total hit count.

### Step 4a.2 — Generate worker prompt

```
=== PROJECT CONTEXT ===
<project context block>
=== END CONTEXT ===

## Objective
Fix all type-safety and async-safety smells in the files listed below.
Do not make any structural changes — do not move classes, split files, or change interfaces.

## Skill to use
type-safety-fix

## Grep results (violations by file)
<paste grep output grouped by file>

## Fix rules (apply all of these)

### as any / : any
Replace with proper types. If the shape is unknown at compile time, use `unknown` with a
type guard narrowing it at the usage site.

### Non-null assertions (!.)
Replace with optional chaining (?.) and nullish coalescing (??) fallbacks.
If null is genuinely impossible, add an explicit runtime guard with a thrown error.

### Empty catch blocks
Every catch must either:
- Log with a [ContextName] prefix: `logger.error('[ServiceName] operationName failed:', err)`
- Re-throw after logging
- Return a typed fallback value (document why in a comment)
Never silently discard errors.

### Floating promises
Every promise must be:
- awaited, or
- explicitly fire-and-forget with a `.catch` error handler, or
- assigned to a variable and tracked

### Missing awaits
Audit async function bodies. Any call to an async function that returns a result used
downstream must be awaited.

## Constraints
- Do not rename any methods, classes, or interfaces
- Do not move any code to different files
- Do not change function signatures unless fixing a return type annotation
- Add missing return type annotations to all public functions

## Verification contract
`npx tsc --noEmit` must return zero errors
Grep for `as any\|: any` must return zero hits in changed files

## Required report format
- Files changed: [list]
- Violations fixed per category: { as_any: N, non_null: N, empty_catch: N, floating_promise: N }
- tsc result: [pass/fail]
- Remaining issues (if any): [list]
- Blockers: [any issues]
```

### Step 4a.3 — Verify

```bash
grep -rn "as any\|: any" src/ --include="*.ts" | grep -v node_modules | grep -v ".d.ts"
npx tsc --noEmit
```

**Stage 4a complete when:** `as any` / `: any` count is zero (or documented exceptions only) AND tsc is clean.

---

## Stage 3 — SOLID Fixes (Phase by Phase)

**Purpose:** Execute the refactoring plan from audit.md, one phase at a time.
Every worker reads audit.md, executes their phase, marks it complete in audit.md, and reports back.

### For each phase, generate this worker prompt:

```
=== PROJECT CONTEXT ===
<project context block>
=== END CONTEXT ===

## Objective
Execute Phase <N>: <phase title> from the refactoring plan.

## Skill to use
solid-fix

## Audit file
Read this file for full context, violation details, and your phase specification:
<audit.md path>

## Your phase
Phase <N>: <title>
Files in scope: <list from audit.md>
Objective: <from audit.md>

## Execution rules
- Read audit.md first — understand the full picture before touching any file
- Execute ONLY your phase — do not fix violations from other phases
- Describe-then-do: before editing each file, state what you will change and why
- One file at a time — complete and verify each file before moving to the next
- After completing your phase, update audit.md: mark `[x] Phase <N>` in the tracker

## Constraints
- Do not touch files outside your phase scope
- Do not change public method signatures unless the audit.md fix explicitly requires it
- Do not introduce new dependencies not already in package.json
- ServiceContainer wiring changes belong ONLY in Phase 7 — do not wire new interfaces early

## Verification contract
`npx tsc --noEmit` must return zero errors
audit.md Phase <N> checkbox must be marked [x]

## Required report format
- Phase completed: [N]
- Files changed: [list]
- Files created: [list]
- Interfaces extracted: [list]
- tsc result: [pass/fail]
- audit.md updated: [yes/no]
- Blockers: [any issues]
```

### After each phase, verify yourself:

```bash
npx tsc --noEmit
```

Read audit.md — confirm the phase checkbox is marked `[x]`.

**Stage 3 complete when:** All phase checkboxes in audit.md are `[x]` AND tsc is clean.

---

## Stage 4b — Structural Smells (Post-Structural)

**Purpose:** Fix structural code quality issues now that SRP splits are complete and
class boundaries have settled.

### Step 4b.1 — Detect

Run yourself:
```bash
# Files over 300 lines
find src/ -name "*.ts" | xargs wc -l | sort -rn | awk '$1 > 300' | head -20

# Functions over 40 lines (heuristic via grep context)
grep -rn "^\s*\(async \)\?\(public\|private\|protected\)\? \?[a-zA-Z].*(.*).*{" src/ --include="*.ts" -A 40 | grep -c "^" | head -20

# Magic strings (quoted non-empty strings not in types/interfaces)
grep -rn '"[a-zA-Z_][a-zA-Z0-9_\-\.]*"' src/ --include="*.ts" | grep -v "\.types\.ts\|interface\|type \|import\|from \|logger\." | head -30

# Deep nesting (4+ levels of indentation — 16 spaces or 4 tabs)
grep -rn "^                " src/ --include="*.ts" | grep -v node_modules | grep -v ".d.ts" | head -20
```

### Step 4b.2 — Generate worker prompt

```
=== PROJECT CONTEXT ===
<project context block>
=== END CONTEXT ===

## Objective
Fix structural code smells in the files listed below.
SOLID compliance is already complete — this pass focuses on readability and maintainability.

## Skill to use
smell-fix

## Detected smells by file
<paste grep output grouped by file>

## Fix rules

### Long methods (>40 lines doing multiple things)
Extract sub-functions with single, clearly named purposes.
The parent method becomes an orchestration sequence of named calls.

### Magic strings/numbers
Extract to named constants at the top of the file or in a dedicated constants file
in the same domain folder. Name must describe meaning, not value.
Example: `MAX_RETRY_ATTEMPTS = 3` not `RETRIES = 3`

### Deep nesting (>3 levels)
Apply early-return / guard-clause pattern to invert conditions and flatten nesting.
Extract deeply nested blocks into named helper functions.

### Inconsistent error handling (mixing throw vs return null)
Pick one strategy per service and apply it consistently:
- Services that coordinate workflows: throw (let caller decide)
- Repository methods: return null / undefined for not-found, throw for infrastructure errors
- Document the chosen strategy in a JSDoc comment on the class

## Constraints
- Do not change any interfaces or public method signatures
- Do not move code to different files (SRP is already done)
- Do not change business logic — only structure and readability

## Verification contract
`npx tsc --noEmit` must return zero errors
No method in changed files exceeds 40 lines

## Required report format
- Files changed: [list]
- Smells fixed per category: { long_methods: N, magic_strings: N, deep_nesting: N, error_handling: N }
- tsc result: [pass/fail]
- Blockers: [any issues]
```

**Stage 4b complete when:** tsc is clean and no method in changed files exceeds 40 lines.

---

## Stage 5 — Architecture Documentation

**Purpose:** Capture the final architecture in three documents while it is fresh.
These docs serve as onboarding material and as the AI context file for future development sessions.

### Generate worker prompt:

```
=== PROJECT CONTEXT ===
<project context block>
=== END CONTEXT ===

## Objective
Produce three architecture documentation files for this codebase.

## Skill to use
docs

## Files to read for source material
- All index.ts barrel files in src/
- All interface files (I*.ts)
- ServiceContainer.ts
- audit.md (for the history of what was changed and why)

## Documents to produce

### 1. docs/architecture/ADR.md — Architecture Decision Records
For each major architectural decision (event bus, CQRS split, repository interfaces,
ServiceContainer wiring, strategy registries), document:
- Context: what problem existed before
- Decision: what pattern was chosen
- Consequences: what it enables, what it constrains, what to watch for

### 2. docs/architecture/modules.md — Module Boundary Map
For each feature domain folder:
- Public interface: what index.ts exports
- Internal classes: what never leaves the folder
- Inbound dependencies: what this module consumes from others
- Outbound dependencies: what other modules consume from this one

### 3. docs/architecture/ai-context.md — AI Context File
A compact file to prepend to any future AI prompt about this codebase.
Format:
  Project: <name> | Stack | Structure
  Key patterns: <list>
  Hard constraints: <list — things that must never be violated>
  Module map: <one line per module: name → public exports>
  Where to add X: <common extension points — e.g. "new payment method → add to PaymentStrategyRegistry">

## Verification contract
All three files must exist and be non-empty
ai-context.md must be under 100 lines (it is prepended to prompts — keep it dense)

## Required report format
- Files created: [list]
- ADR decisions documented: [count]
- Modules mapped: [count]
- ai-context.md line count: [N]
- Blockers: [any issues]
```

**Stage 5 complete when:** All three docs exist and ai-context.md is under 100 lines.