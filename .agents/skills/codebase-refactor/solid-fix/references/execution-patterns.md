# Execution Patterns — SOLID Fix Reference

Detailed patterns for the most common fix types encountered in each phase.

---

## Phase 1: Splitting a Monolithic Types File

### Pattern: Layer-based split

```
Before: coreTypes.ts (everything mixed)

After:
  src/dtos/types.ts           — External DTO/API structures (e.g., UserResponseDto, OrderPayload)
  src/domain/types.ts         — Core domain entities (e.g., User, Order, Item)
  src/infrastructure/types.ts — Library/database specific types (e.g., PrismaUserQuery, SocketConfig)
```

### Execution steps
1. Create the new type files.
2. Move type definitions — do NOT duplicate. Each type should belong to exactly one file.
3. If a type is used in both infrastructure/DTO and domain layers, put it in the domain layer (or shared types) and import it where needed.
4. Update every import across the codebase:
```bash
# Find all files importing from the old types file
grep -rn "from.*['\"].*coreTypes['\"]" src/ --include="*.ts"
grep -rn "from.*['\"].*coreTypes['\"]" src/ --include="*.tsx"
```
5. Delete or empty the original types file (or make it a re-export barrel file temporarily).

### Pattern: Event types split

```
Before: EventTypes.ts (all events + EventMap)

After:
  events/userEvents.ts     — user:created, user:updated, user:deleted
  events/orderEvents.ts    — order:placed, order:shipped, order:cancelled
  events/systemEvents.ts   — system:startup, system:error
  EventTypes.ts            — imports all sub-files, exports unified EventMap only
```

---

## Phase 2: Splitting a Fat Repository Interface

### Pattern: ISP split by concern

```typescript
// Before — fat interface
export interface IUserRepository {
  // User profile operations
  createUser(data: UserCreateInput): Promise<void>
  findUserById(id: string): Promise<User | null>
  updateProfile(id: string, profile: ProfileData): Promise<void>
  
  // Order history operations
  getUserOrders(userId: string): Promise<Order[]>
  addOrderToHistory(userId: string, orderId: string): Promise<void>
  
  // Session operations
  createSession(userId: string, token: string): Promise<void>
  invalidateSession(token: string): Promise<void>
}

// After — three focused interfaces
export interface IUserRepository {
  createUser(data: UserCreateInput): Promise<void>
  findUserById(id: string): Promise<User | null>
  updateProfile(id: string, profile: ProfileData): Promise<void>
}

export interface IUserOrderRepository {
  getUserOrders(userId: string): Promise<Order[]>
  addOrderToHistory(userId: string, orderId: string): Promise<void>
}

export interface IUserSessionRepository {
  createSession(userId: string, token: string): Promise<void>
  invalidateSession(token: string): Promise<void>
}
```

### The concrete class implements all of them
```typescript
export class UserRepository
  implements IUserRepository, IUserOrderRepository, IUserSessionRepository {
  // all methods implemented here — nothing changes in the implementation
}
```

### Consumers use only the interface they need
```typescript
// Before
constructor(private userRepo: IUserRepository) {}
// used userRepo.createSession() — wrong interface for user/profile management

// After
constructor(
  private userRepo: IUserRepository,
  private sessionRepo: IUserSessionRepository  // ← specific interface
) {}
```

---

## Phase 3: Event Bus Abstraction

### Pattern: Extract IEventBus

```typescript
// New file: events/IEventBus.ts
export interface IEventBus {
  on<K extends keyof EventMap>(
    event: K,
    handler: (payload: EventMap[K]) => Promise<void> | void
  ): void

  off<K extends keyof EventMap>(
    event: K,
    handler: (payload: EventMap[K]) => Promise<void> | void
  ): void

  emit<K extends keyof EventMap>(
    event: K,
    payload: EventMap[K]
  ): Promise<void>

  removeAllListeners(event?: keyof EventMap): void
}

// EventBus.ts — implements the interface
export class EventBus implements IEventBus {
  // existing implementation unchanged
}
```

### Update IEventSubscriber

```typescript
// Before
import { EventBus } from './EventBus'
export interface IEventSubscriber {
  register(bus: EventBus): void  // ← concrete dependency
  dispose(): void
}

// After
import { IEventBus } from './IEventBus'
export interface IEventSubscriber {
  register(bus: IEventBus): void  // ← interface dependency
  dispose(): void
}
```

---

## Phase 4: Leaf Service — DIP Fix

### Pattern: Extract repository interface + inject

```typescript
// New file: repositories/IInvoiceRepository.ts
export interface IInvoiceRepository {
  save(invoice: Invoice): Promise<void>
  findById(id: string): Promise<Invoice | null>
  findPending(): Promise<Invoice[]>
}

// InvoiceService.ts — before
import { DatabaseClient } from '../db/DatabaseClient'
export class InvoiceService {
  private db = new DatabaseClient()  // ← DIP violation (coupling to concrete client)

  async createInvoice(data: InvoiceInput) {
    const invoice = this.calculateInvoice(data)
    await this.db.invoice.save(...)  // ← SRP violation (persistence logic embedded in service)
  }
}

// InvoiceService.ts — after
import { IInvoiceRepository } from './IInvoiceRepository'
export class InvoiceService {
  constructor(
    private invoiceRepo: IInvoiceRepository  // ← injected interface
  ) {}

  async createInvoice(data: InvoiceInput): Promise<void> {
    const invoice = this.calculateInvoice(data)
    await this.invoiceRepo.save(invoice)  // ← delegates to repository
  }
}
```

---

## Phase 5: Mid-Level Service — OCP Fix (Strategy Registry)

### Pattern: Replace switch block with strategy registry

```typescript
// Before — OCP violation
async processPayment(paymentType: string, amount: number) {
  if (paymentType === 'credit_card') {
    await this.chargeCreditCard(amount)
  } else if (paymentType === 'paypal') {
    await this.chargePaypal(amount)
  } else if (paymentType === 'stripe') {
    await this.chargeStripe(amount)
  } else if (paymentType === 'crypto') {
    await this.chargeCrypto(amount)
  }
  // Adding a new payment type = editing this method ← OCP violation
}

// After — strategy registry
// New file: payment/IPaymentStrategy.ts
export interface IPaymentStrategy {
  supports(paymentType: string): boolean
  charge(amount: number): Promise<void>
}

// New file: payment/PaymentStrategyRegistry.ts
const strategies: IPaymentStrategy[] = [
  new CreditCardStrategy(), // handles 'credit_card'
  new PaypalStrategy(),     // handles 'paypal'
  new StripeStrategy(),     // handles 'stripe'
  new CryptoStrategy(),     // handles 'crypto'
]
export function resolvePaymentStrategy(paymentType: string): IPaymentStrategy | undefined {
  return strategies.find(s => s.supports(paymentType))
}

// PaymentService.ts — after
async processPayment(paymentType: string, amount: number): Promise<void> {
  const strategy = resolvePaymentStrategy(paymentType)
  if (!strategy) {
    logger.error('No payment strategy for type:', paymentType)
    return
  }
  await strategy.charge(amount)
  // Adding a new payment type = new file + register in PaymentStrategyRegistry ← OCP satisfied
}
```

---

## Phase 6: Pipeline Orchestrator — SRP Split (CQRS)

### Pattern: Split Fat Service into Query (Read) and Command (Write) sides

```typescript
// New file: services/orders/IOrderWriteService.ts
export interface IOrderWriteService {
  createOrder(input: OrderCreateInput): Promise<void>
  cancelOrder(id: string): Promise<void>
  updateShippingAddress(id: string, address: Address): Promise<void>
}

// New file: services/orders/IOrderQueryService.ts
export interface IOrderQueryService {
  getOrderById(id: string): Promise<OrderDetails | null>
  searchOrders(query: OrderSearchQuery): Promise<OrderDetails[]>
}

// OrderWriteService.ts — implements IOrderWriteService
export class OrderWriteService implements IOrderWriteService {
  constructor(
    private orderRepo: IOrderRepository,
    private inventoryService: IInventoryService,
    private eventBus: IEventBus,
    private actionRegistry: IOrderActionRegistry  // ← OCP registry
  ) {}

  async createOrder(input: OrderCreateInput): Promise<void> {
    const handler = this.actionRegistry.resolve(input.type)
    if (!handler) return
    await handler.execute(input)
  }
}

// OrderQueryService.ts — implements IOrderQueryService
export class OrderQueryService implements IOrderQueryService {
  constructor(
    private queryRepo: IOrderQueryRepository,
    private cacheService: ICacheService
  ) {}

  async getOrderById(id: string): Promise<OrderDetails | null> {
    const cached = await this.cacheService.get(id)
    if (cached) return cached
    const order = await this.queryRepo.findById(id)
    return order ? this.enrich(order) : null
  }
}
```

---

## Phase 7: ServiceContainer Wiring

### Pattern: Map keys to interfaces, not concrete classes

```typescript
// Before
export type Services = {
  orderService: OrderService            // ← concrete class
  userService: UserService              // ← concrete class
  paymentService: PaymentService        // ← concrete class
  eventBus: EventBus                    // ← concrete class
}

// After
import { IOrderWriteService } from './services/orders/IOrderWriteService'
import { IOrderQueryService } from './services/orders/IOrderQueryService'
import { IUserService } from './services/users/IUserService'
import { IPaymentService } from './services/payment/IPaymentService'
import { IEventBus } from './events/IEventBus'

export type Services = {
  orderWriteService: IOrderWriteService   // ← interface
  orderQueryService: IOrderQueryService   // ← interface
  userService: IUserService               // ← interface
  paymentService: IPaymentService         // ← interface
  eventBus: IEventBus                     // ← interface
}

// createServices function — still instantiates concrete classes,
// but the type system enforces the interface contract
function createServices(repos: Repositories): Services {
  const eventBus = new EventBus()
  const userService = new UserService(repos.userRepo, repos.profileRepo)
  const orderQueryService = new OrderQueryService(repos.orderQueryRepo, cacheService)
  const orderWriteService = new OrderWriteService(
    repos.orderRepo, inventoryService, eventBus, orderActionRegistry
  )
  const paymentService = new PaymentService(repos.paymentRepo)
  
  return { eventBus, userService, orderQueryService, orderWriteService, paymentService }
}
```