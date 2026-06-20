# Smell Patterns — Additional Examples and Edge Cases

---

## Long Methods — Edge Cases

### When NOT to extract
- The method is already a sequence of awaits with no branching — it is readable as-is
- The sub-logic needs 5+ parameters from parent scope — this is a class-level SRP issue
  (flag as blocker; do not extract a method with a huge parameter list)
- The method is a simple builder/factory that returns one object — length is acceptable

### Extracting async sub-methods
```typescript
// Before — mixed concerns in one async method
private async enrichOrder(order: DBOrder): Promise<EnrichedOrder> {
  // 20 lines resolving customer name
  const customer = await this.customerRepo.findById(order.customerId)
  const name = customer?.displayName
    ?? customer?.legalName
    ?? order.customerId.split('_')[0]

  // 15 lines resolving store context
  let storeName: string | undefined
  if (order.storeId.startsWith('store_')) {
    const store = await this.storeRepo.findById(order.storeId)
    storeName = store?.name
  }

  // 10 lines building the result
  return { ...order, customerName: name, storeName }
}

// After
private async enrichOrder(order: DBOrder): Promise<EnrichedOrder> {
  const customerName = await this.resolveCustomerName(order.customerId)
  const storeName = await this.resolveStoreName(order.storeId)
  return { ...order, customerName, storeName }
}

private async resolveCustomerName(id: string): Promise<string> {
  const customer = await this.customerRepo.findById(id)
  return customer?.displayName ?? customer?.legalName ?? id.split('_')[0]
}

private async resolveStoreName(storeId: string): Promise<string | undefined> {
  if (!storeId.startsWith('store_')) return undefined
  const store = await this.storeRepo.findById(storeId)
  return store?.name
}
```

---

## Magic Strings — Edge Cases

### Identifier Prefixes — always extract
These prefixes appear throughout the codebase and their meaning is non-obvious:
```typescript
const CUSTOMER_PREFIX_GUEST   = 'guest_'
const CUSTOMER_PREFIX_MEMBER  = 'member_'
const CUSTOMER_PREFIX_PARTNER = 'partner_'
const CUSTOMER_PREFIX_API     = 'api_'
```

### Status strings — extract to enum or const object
```typescript
// Before
order.status = 'pending'
if (order.status === 'processing') { ... }
if (order.status === 'shipped') { ... }

// After
const OrderStatus = {
  PENDING:    'pending',
  PROCESSING: 'processing',
  SHIPPED:    'shipped',
  DELIVERED:  'delivered',
  CANCELLED:  'cancelled',
} as const
type OrderStatus = typeof OrderStatus[keyof typeof OrderStatus]

order.status = OrderStatus.PENDING
if (order.status === OrderStatus.PROCESSING) { ... }
```

### Event names — extract to const if used in multiple places
```typescript
// Only extract if used in 3+ places
const AppEvents = {
  ORDER_CREATED: 'order:created',
  ORDER_UPDATED: 'order:updated',
  USER_UPDATED:  'user:updated',
} as const
```

### What to leave as-is
- `'utf-8'` encoding strings — universally understood
- `'POST'`, `'GET'` HTTP methods — universally understood
- Single-use strings where the string itself is the documentation
- ORM/Database schema model names in repository files — they are the schema, not magic

---

## Deep Nesting — Edge Cases

### Optional chaining can replace nesting
```typescript
// Before — 3 levels of null checks
if (update) {
  if (update.order) {
    if (update.order.shippingAddress) {
      process(update.order.shippingAddress)
    }
  }
}

// After — one line
const shippingAddress = update?.order?.shippingAddress
if (shippingAddress) process(shippingAddress)
```

### Switch statements inside loops
```typescript
// Before — switch inside loop creates nesting
for (const event of events) {
  switch (event.type) {
    case 'order':
      // 10 lines
      break
    case 'payment':
      // 10 lines
      break
  }
}

// After — extract handler per type
for (const event of events) {
  await this.handleEvent(event)
}

private async handleEvent(event: AppEvent): Promise<void> {
  switch (event.type) {
    case 'order':   return this.handleOrderEvent(event)
    case 'payment': return this.handlePaymentEvent(event)
    default:
      logger.warn('[EventHandler] unknown event type:', event.type)
  }
}
```

### Ternary chains — flatten with early return
```typescript
// Before — nested ternary
const label = item.name
  ? item.name.slice(0, 80)
  : item.hasCode
  ? 'Barcode'
  : item.hasImage
  ? 'Image'
  : 'Item'

// After — readable switch or guard clauses
function getItemLabel(item: Item): string {
  if (item.name)     return item.name.slice(0, PREVIEW_MAX_LENGTH)
  if (item.hasCode)  return 'Barcode'
  if (item.hasImage) return 'Image'
  return 'Item'
}
```

---

## Inconsistent Error Handling — Common Patterns

### Repository contract: null vs throw
```typescript
// find* → null for not found
async findById(id: string): Promise<Order | null> {
  return this.db.order.findUnique({ where: { id } }) // ORM returns null
}

// find* → throw for bad input (not a "not found" case)
async findById(id: string): Promise<Order | null> {
  if (!id) throw new Error('[OrderRepository] id is required')
  return this.db.order.findUnique({ where: { id } })
}

// write operations → throw on all failures
async insert(data: OrderInsertData): Promise<Order> {
  return this.db.order.create({ data })
  // ORM throws on constraint violations — let it propagate
}
```

### Service contract: always throw
```typescript
// Services throw — callers (controllers, event handlers) catch and handle
async getOrders(query: OrderQuery): Promise<EnrichedOrder[]> {
  // No try-catch here — failures propagate to the handler layer
  const orders = await this.queryRepo.findMany(query)
  return this.enrich(orders)
}
```

### Event handler / subscriber contract: log + continue
```typescript
// Subscribers must NEVER throw — a throw kills the entire event bus
register(bus: IEventBus): void {
  bus.on('order:created', async (order) => {
    try {
      await this.persist(order)
    } catch (err: unknown) {
      logger.error('[PersistenceSubscriber] failed to persist order:', err)
      // Do NOT rethrow — other subscribers must still run
    }
  })
}
```

### Request handler contract: typed result object
```typescript
// Request handlers return typed results — never throw to the client
handleRequest(query: Query): Promise<Result> {
  try {
    const data = await this.queryService.fetch(query)
    return { success: true, data }
  } catch (err: unknown) {
    logger.error('[RequestHandler] fetch failed:', err)
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
```