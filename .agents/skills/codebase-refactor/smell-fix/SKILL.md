---
name: smell-fix
description: |
  Fixes structural code quality smells in TypeScript files after SOLID compliance is
  established. Use when the orchestrator assigns a Stage 4b task. Targets long methods,
  magic strings/numbers, deep nesting, and inconsistent error handling. Never changes
  business logic, moves code between files, or renames public interfaces. Triggers on
  phrases like "fix structural smells", "clean up long methods", "fix magic strings",
  "fix deep nesting", or when the orchestrator hands off a Stage 4b worker prompt.
version: 1.0.0
tags:
  - code-quality
  - refactoring
  - typescript
  - clean-code
---

# Structural Smell Fix Worker

You are a stateless worker. You receive a list of files with detected structural smells.
Your job is to fix every smell in scope, verify with tsc, and report back.

You do not change business logic. You do not move code between files. You do not rename
public interfaces. Your changes affect only structure and readability within each file.

---

## Pre-Flight

Before editing any file:

1. Read every file in scope provided by the orchestrator
2. Identify all smell instances — count them per category per file
3. Read `references/smell-patterns.md` for the fix patterns
4. Note dependencies between fixes — e.g. extracting a long method may also flatten nesting

Process files in order of total smell count — highest first.

---

## Smell 1 — Long Methods (>40 lines doing multiple things)

A long method is almost always doing more than one thing. The fix is to extract
sub-functions with single, clearly named purposes. The parent method becomes a
readable orchestration sequence.

**Test before extracting:** If the sub-method needs more than 2-3 parameters from the
parent scope, it may be a sign the parent class has an SRP violation (Stage 3 territory).
In that case, extract what you can and flag the rest as a blocker.

```typescript
// Before — 60-line method doing parsing + validation + saving + notification
async processPayment(raw: RawPaymentPayload): Promise<void> {
  // 15 lines of parsing
  const provider = raw.payment ? Object.keys(raw.payment)[0] : 'unknown'
  const details = raw.payment?.details ?? raw.payment?.extendedDetails?.text ?? ''
  // ... more parsing

  // 10 lines of validation
  if (!raw.account?.id) return
  if (raw.account.isInternal && !this.includeInternal) return
  // ... more validation

  // 20 lines of saving
  await this.repo.insert({ ... })
  // ...

  // 15 lines of notification
  this.eventBus.emit('payment:processed', { ... })
  // ...
}

// After — orchestration at the top, focused helpers below
async processPayment(raw: RawPaymentPayload): Promise<void> {
  const parsed = this.parsePayment(raw)
  if (!this.isValid(parsed)) return
  const saved = await this.persist(parsed)
  await this.notify(saved)
}

private parsePayment(raw: RawPaymentPayload): ParsedPayment { ... }
private isValid(payment: ParsedPayment): boolean { ... }
private async persist(payment: ParsedPayment): Promise<SavedPayment> { ... }
private async notify(payment: SavedPayment): Promise<void> { ... }
```

**Naming rule:** Extracted method names must describe what they do, not how.
- ✅ `parsePaymentProvider()`, `validateAccount()`, `persistToDatabase()`
- ❌ `doStep1()`, `helper()`, `process2()`

---

## Smell 2 — Magic Strings and Numbers

A magic value is any string or number literal whose meaning is not obvious from context.
The fix is a named constant that makes the meaning explicit.

**Where to put constants:**
- File-level: use `const` at the top of the file for constants used only in that file
- Domain-level: create or append to `<domain>/constants.ts` for constants shared across
  a domain folder
- Never import constants from outside the domain — duplicate them if needed

```typescript
// Before
if (email.endsWith('@gmail.com')) { ... }
if (email.endsWith('@yahoo.com')) { ... }
await sleep(3000)
if (retries >= 5) throw new Error('too many retries')
const PREVIEW_LENGTH = text.slice(0, 80)

// After
const DOMAIN_GMAIL = '@gmail.com'
const DOMAIN_YAHOO = '@yahoo.com'
const RECONNECT_DELAY_MS = 3000
const MAX_RETRY_ATTEMPTS = 5
const PREVIEW_CHAR_LIMIT = 80

if (email.endsWith(DOMAIN_GMAIL)) { ... }
if (email.endsWith(DOMAIN_YAHOO)) { ... }
await sleep(RECONNECT_DELAY_MS)
if (retries >= MAX_RETRY_ATTEMPTS) throw new Error('max retries exceeded')
const preview = text.slice(0, PREVIEW_CHAR_LIMIT)
```

**What is NOT a magic string:**
- Error messages (they are readable as-is)
- Log messages
- SQL/ORM query parameters in repository files (they are inherently string-based)
- Import paths

---

## Smell 3 — Deep Nesting (>3 levels of if/loop)

Deep nesting makes control flow hard to follow. The fix is the **guard clause** pattern:
invert conditions to return early, flattening the happy path.

Count indentation levels from the function body. 3 levels = 3 nested blocks inside the function.

```typescript
// Before — 4 levels deep
async handleUpdate(update: OrderUpdate): Promise<void> {
  if (update) {
    if (update.orderId) {
      if (!update.isDraft) {
        for (const change of update.changes) {
          if (change.type === 'status') {
            await this.repo.updateStatus(update.orderId, change.value)
          }
        }
      }
    }
  }
}

// After — guard clauses flatten the nesting
async handleUpdate(update: OrderUpdate): Promise<void> {
  if (!update?.orderId) return
  if (update.isDraft) return

  for (const change of update.changes) {
    if (change.type !== 'status') continue
    await this.repo.updateStatus(update.orderId, change.value)
  }
}
```

**For deeply nested loops:** Extract the loop body to a named method.

```typescript
// Before
for (const order of orders) {
  for (const item of order.items) {
    if (item.category === 'hardware') {
      for (const tag of item.tags) {
        if (tag.active) {
          await this.applyHardwareTag(item.id, tag.value)
        }
      }
    }
  }
}

// After
for (const order of orders) {
  await this.syncOrderHardwareTags(order)
}

private async syncOrderHardwareTags(order: Order): Promise<void> {
  const hardwareItems = order.items.filter(i => i.category === 'hardware')
  for (const item of hardwareItems) {
    const activeTags = item.tags.filter(t => t.active)
    await Promise.all(activeTags.map(t => this.applyHardwareTag(item.id, t.value)))
  }
}
```

---

## Smell 4 — Inconsistent Error Handling

A service that sometimes throws, sometimes returns null, and sometimes returns undefined
forces every caller to handle three different failure modes.

Pick one strategy per class and apply it consistently throughout that class.

| Class type | Recommended strategy |
|---|---|
| Repository methods | Return `null` / `undefined` for not-found; throw for infrastructure errors |
| Service orchestrators | Throw for all failures (let caller decide) |
| Event handlers/subscribers | Log + return (never crash the bus) |
| Request handlers | Return typed `{ success: false, error: string }` result objects |

```typescript
// Before — inconsistent in the same class
async findUser(id: string) {
  const user = await this.repo.find(id)
  return user  // returns undefined if not found — caller must check
}

async upsertUser(id: string, data: UserData) {
  if (!id) throw new Error('id required')  // throws
  await this.repo.upsert(id, data)
}

async deleteUser(id: string) {
  try {
    await this.repo.delete(id)
  } catch {
    return false  // returns false — completely different pattern
  }
  return true
}

// After — consistent throw strategy throughout the service
async findUser(id: string): Promise<User | null> {
  return this.repo.find(id)  // null for not-found, throw for infra errors
}

async upsertUser(id: string, data: UserData): Promise<void> {
  if (!id) throw new Error('[UserService] id is required')
  await this.repo.upsert(id, data)
}

async deleteUser(id: string): Promise<void> {
  await this.repo.delete(id)  // throws on failure — consistent
}
```

**Document the strategy:** Add a JSDoc comment on the class stating the error handling
contract so future developers don't inadvertently break consistency.

```typescript
/**
 * Manages user profile configuration and persistence.
 *
 * Error handling contract:
 * - find* methods: return null if not found, throw on infrastructure errors
 * - write methods: throw on all failures, never return boolean success flags
 */
export class UserService implements IUserService {
```

---

## What You Must NOT Do

- Do not change business logic — only structure and readability
- Do not move code to different files
- Do not rename public methods or interfaces
- Do not add new class-level dependencies
- Do not change method signatures
- Do not fix SOLID violations — those are done in Stage 3

If an extracted sub-method would need to be public (e.g. it is tested elsewhere),
flag it as a blocker and leave that method alone.

---

## Verification

After each file:
```bash
npm run typecheck
```

Final check — no method over 40 lines in changed files:
```bash
# Rough heuristic — count lines between method signatures
grep -n "^\s*\(async \)\?\(public\|private\|protected\)" <file> | head -30
```

**Test execution:** Read `package.json` to discover the test script (e.g. `npm test`).
If a test script exists, run it after tsc verification passes. Report the result.

---

## Required Report Format

```
## Smell Fix Report

Files changed: [list]

Smells fixed:
  long_methods: N
  magic_strings: N
  magic_numbers: N
  deep_nesting: N
  inconsistent_error_handling: N

Per-file summary:
  [FileName]: [what was fixed]
  [FileName]: [what was fixed]

tsc result: [zero errors / N errors]

Blockers:
  [file + method]: [why it could not be safely fixed]
```

## Reference Files

- `references/smell-patterns.md` — Additional examples and edge cases per smell type