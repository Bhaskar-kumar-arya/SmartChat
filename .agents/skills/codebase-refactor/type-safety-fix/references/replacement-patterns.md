# Replacement Patterns — Quick Reference

---

## as any → unknown + type guard

```typescript
// Before
function handle(data: any) {
  return data.payload.text
}

// After
interface HandlerData {
  payload: { text: string }
}
function isHandlerData(v: unknown): v is HandlerData {
  return !!v && typeof v === 'object' && 'payload' in v
}
function handle(data: unknown): string {
  if (!isHandlerData(data)) throw new Error('[Handler] unexpected shape')
  return data.payload.text
}
```

---

## as any on third-party event → local interface

```typescript
// Before
emitter.on('data', (event: any) => {
  const item = event.items[0]
  const type = event.action
})

// After
interface DataUpdateEvent {
  items: string[]
  action: 'add' | 'remove'
}
emitter.on('data', (event: DataUpdateEvent) => {
  const item = event.items[0]
  const type = event.action
})
```

---

## !. on optional chain

```typescript
// Before
const id = this.userId!.split('_')[0]
const name = user!.displayName!

// After
const id = this.userId?.split('_')[0] ?? ''
const name = user?.displayName ?? 'Guest'
```

---

## !. where null is a programming error

```typescript
// Before
const connection = this.connection!
connection.send(payload)

// After
if (!this.connection) {
  throw new Error('[ConnectionManager] connection not initialized — call connect() first')
}
this.connection.send(payload)
```

---

## Empty catch → log + rethrow

```typescript
// Before
try {
  await this.save(data)
} catch (e) {}

// After
try {
  await this.save(data)
} catch (err: unknown) {
  logger.error('[ServiceName] save failed:', err)
  throw err
}
```

---

## Empty catch → log + fallback

```typescript
// Before
try {
  return await this.repo.find(id)
} catch (_e) {}

// After
try {
  return await this.repo.find(id)
} catch (err: unknown) {
  logger.error('[ServiceName] find failed for id:', id, err)
  return null
}
```

---

## .catch(() => {}) → .catch with logging

```typescript
// Before
this.saveData(record).catch(() => {})

// After
this.saveData(record).catch((err: unknown) => {
  logger.error('[DataService] background save failed:', err)
})
```

---

## Floating promise → fire-and-forget

```typescript
// Before (floating, no handling)
this.notifyClients('user:updated', data)

// After
void this.notifyClients('user:updated', data).catch((err: unknown) => {
  logger.error('[NotificationService] broadcast failed:', err)
})
```

---

## Missing return type → explicit annotation

```typescript
// Before
public async findById(id: string) {
  return this.db.user.findFirst({ where: { id } })
}

// After
public async findById(id: string): Promise<User | null> {
  return this.db.user.findFirst({ where: { id } })
}
```

---

## catch (e) with unknown → typed narrowing

```typescript
// Before — common in older TS, e is implicitly any
} catch (e) {
  console.error(e.message) // unsafe
}

// After
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  logger.error('[ServiceName] operation failed:', message)
}
```

---

## Type guard template

```typescript
// For object shapes
function isX(v: unknown): v is X {
  return (
    !!v &&
    typeof v === 'object' &&
    'requiredField' in v &&
    typeof (v as Record<string, unknown>).requiredField === 'string'
  )
}

// For arrays of a type
function isXArray(v: unknown): v is X[] {
  return Array.isArray(v) && v.every(isX)
}

// For discriminated unions
function isTextMessage(v: unknown): v is TextMessage {
  return !!v && typeof v === 'object' && 'type' in v &&
    (v as { type: unknown }).type === 'text'
}
```