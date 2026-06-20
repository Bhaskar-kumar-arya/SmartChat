---
name: type-safety-fix
description: |
  Fixes type-safety and async-safety smells in TypeScript files without making any
  structural changes. Use when the orchestrator assigns a Stage 4a task. Replaces
  `as any`, non-null assertions, empty catches, floating promises, and missing return
  types. Never moves code between files or renames anything. Triggers on phrases like
  "fix type safety issues", "clean up the any types", "fix empty catches", or when
  the orchestrator hands off a Stage 4a worker prompt.
version: 1.0.0
tags:
  - typescript
  - type-safety
  - async
  - refactoring
---

# Type Safety Fix Worker

You are a stateless worker. You receive a list of files with detected type-safety and
async-safety violations. Your job is to fix every violation, verify with tsc, and report
back. You make zero structural changes — no file moves, no renames, no class splits.

---

## Pre-Flight

Before touching any file:

1. Read every file in scope from the grep results provided
2. Understand the full context of each violation — a `!.` might be genuinely safe if there
   is a prior null check; an `as any` might be a third-party type gap
3. Note which violations need a type guard written vs which are simple substitutions
4. Read `references/replacement-patterns.md` for the exact patterns to apply

Process files in order of violation count — highest first. This surfaces tricky cases early
when your context is freshest.

---

## Fix Rules

### Rule 1 — `as any` and `: any`

Never cast to `any`. Every `any` represents a hole in the type system that can hide
runtime crashes.

**If the shape is known:** Replace with the correct type. Check if the library already
exports it (`import type { X } from 'library'`).

**If the shape comes from an external/unknown source:** Use `unknown` and write a type
guard that narrows it at the point of use.

**If it is a third-party event payload:** Declare a local interface for exactly the fields
you access. Do not try to type the entire payload.

```typescript
// ❌
const payload = event.data as any
const name = payload.user.name

// ✅
interface UserPayload {
  user: { name: string; id: string }
  timestamp: number
}
function isUserPayload(v: unknown): v is UserPayload {
  return !!v && typeof v === 'object' && 'user' in v
}
const payload = event.data
if (!isUserPayload(payload)) {
  logger.error('[HandlerName] unexpected payload shape:', payload)
  return
}
const name = payload.user.name
```

### Rule 2 — Non-null assertions (`!.`)

Non-null assertions tell the compiler to trust you. If you are wrong, the crash is silent.
Replace with explicit guards.

**If null is a recoverable case:** Use optional chaining + nullish coalescing.

**If null is genuinely impossible:** Add an explicit runtime guard with a clear thrown error
so the failure is loud and traceable.

```typescript
// ❌
const name = user!.profile!.displayName

// ✅ — null is recoverable
const name = user?.profile?.displayName ?? 'Anonymous'

// ✅ — null is a programming error
if (!user) throw new Error('[UserService] user must be defined at this point')
const name = user.profile?.displayName ?? 'Anonymous'
```

### Rule 3 — Empty catch blocks

An empty catch silently discards failures. Every catch must do one of:
- Log with context prefix + re-throw
- Log with context prefix + return a typed fallback
- Log with context prefix + handle explicitly

The context prefix format is `[ClassName]` or `[ServiceName]`. It makes log searching
possible.

```typescript
// ❌
try {
  await this.repo.save(record)
} catch (e) {}

// ✅ — log and re-throw (caller decides how to handle)
try {
  await this.repo.save(record)
} catch (err: unknown) {
  logger.error('[DataService] save failed:', err)
  throw err
}

// ✅ — log and return fallback (non-critical path)
try {
  return await this.repo.findById(id)
} catch (err: unknown) {
  logger.error('[UserService] findById failed, returning null:', err)
  return null
}
```

### Rule 4 — Floating promises

A floating promise is one that is not awaited, not `.catch`-handled, and not stored.
If it rejects, the error is silently swallowed (or causes an unhandled rejection crash).

**If the result is needed:** Add `await`.

**If it is genuinely fire-and-forget:** Add `.catch` with error logging.

```typescript
// ❌ — floating, rejection silently lost
this.notificationService.sendNotification(user)

// ✅ — fire-and-forget with safety net
this.notificationService.sendNotification(user).catch((err: unknown) => {
  logger.error('[NotificationService] background notification failed:', err)
})

// ✅ — awaited when result is needed downstream
await this.notificationService.sendNotification(user)
```

### Rule 5 — Missing return types on public functions/methods

Every public function and method must have an explicit return type. This prevents
accidental return type widening when internals change.

```typescript
// ❌
public async getItems(query: ItemQuery) {
  return this.repo.findMany(query)
}

// ✅
public async getItems(query: ItemQuery): Promise<Item[]> {
  return this.repo.findMany(query)
}
```

Private methods: add return types only if they are complex or non-obvious.
Arrow functions assigned to variables: add return types if they are exported.

---

## What You Must NOT Do

- Do not rename any class, method, interface, or variable
- Do not move any code to a different file
- Do not change function signatures beyond adding return type annotations
- Do not refactor for SOLID compliance — that is Stage 3's job
- Do not add new imports beyond what is needed for type guards and logger
- Do not change business logic to fix a type error — if fixing the type requires logic
  changes, flag it as a blocker and leave it for Stage 3

---

## Logger Usage

If the codebase has an existing logger, use it. If not, use `console.error` with the
context prefix. Do not introduce a new logging library.

```typescript
// Find the existing logger
grep -rn "logger\|Logger" src/ --include="*.ts" | head -10
```

---

## Verification

After fixing each file, run:

```bash
npm run typecheck
```

Fix any type errors introduced by your changes before moving to the next file.
Do not leave a file in a broken state.

Final verification after all files:

```bash
# Confirm as any is gone from changed files
grep -n "as any\|: any" <changed-files>

# Confirm non-null assertions are gone
grep -n "\!." <changed-files>

# Confirm empty catches are gone
grep -n "catch.*{}" <changed-files>

# tsc clean
npm run typecheck
```

**Test execution:** Read `package.json` to discover the test script (e.g. `npm test`).
If a test script exists, run it after tsc verification passes. Report the result.

---

## Required Report Format

```
## Type Safety Fix Report

Files changed: [list]

Violations fixed:
  as_any: N
  non_null_assertions: N
  empty_catches: N
  floating_promises: N
  missing_return_types: N

tsc result: [zero errors / N errors — paste errors if any]

Remaining issues (could not be safely fixed without structural changes):
  [file]: [description of issue and why it needs Stage 3]

Blockers: [anything that prevented fixes]
```

## Reference Files

- `references/replacement-patterns.md` — Quick-reference substitution table for all patterns