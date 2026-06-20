# Circular Dependency Fix Patterns

Detailed examples for each cycle category.

---

## Interface/Implementation — Detailed Example

### Before (broken)
```typescript
// IUserRepository.ts
import { UserCreateInput, UserWithProfile } from './UserRepository' // ← cycle!

export interface IUserRepository {
  create(data: UserCreateInput): Promise<void>
  getWithProfile(id: string): Promise<UserWithProfile | null>
}

// UserRepository.ts
import { IUserRepository } from './IUserRepository' // ← cycle closes here

export type UserCreateInput = { email: string; name: string }
export type UserWithProfile = { user: User; profile: Profile }

export class UserRepository implements IUserRepository { ... }
```

### After (fixed)
```typescript
// users.types.ts  ← NEW FILE
export type UserCreateInput = { email: string; name: string }
export type UserWithProfile = { user: User; profile: Profile }

// IUserRepository.ts
import { UserCreateInput, UserWithProfile } from './users.types' // ← no cycle

export interface IUserRepository {
  create(data: UserCreateInput): Promise<void>
  getWithProfile(id: string): Promise<UserWithProfile | null>
}

// UserRepository.ts
import { IUserRepository } from './IUserRepository'
import { UserCreateInput, UserWithProfile } from './users.types'

export class UserRepository implements IUserRepository { ... }
```

---

## Initialization — Detailed Example

### Before (broken)
```typescript
// BillingManager.ts
import { ServiceContainer } from '../../ServiceContainer' // ← cycle!

export class BillingManager {
  constructor(private services: ServiceContainer) {}

  async process() {
    await this.services.invoiceRepo.bulkInsert(...)
    await this.services.userRepo.updateStatus(...)
    this.services.notificationService.notify('billing:complete', ...)
  }
}

// ServiceContainer.ts
import { BillingManager } from './services/billing/BillingManager' // ← cycle closes
```

### After (fixed)
```typescript
// BillingManager.ts
import { IInvoiceRepository } from '../invoices/IInvoiceRepository'
import { IUserRepository } from '../users/IUserRepository'
import { INotificationService } from './INotificationService'

export class BillingManager {
  constructor(
    private invoiceRepo: IInvoiceRepository,
    private userRepo: IUserRepository,
    private notificationService: INotificationService
  ) {}

  async process() {
    await this.invoiceRepo.bulkInsert(...)
    await this.userRepo.updateStatus(...)
    this.notificationService.notify('billing:complete', ...)
  }
}

// ServiceContainer.ts — wires explicitly
const billingManager = new BillingManager(
  invoiceRepo,
  userRepo,
  notificationService
)
```

---

## Shared Types — Detailed Example

### Before (broken)
```typescript
// ReportGenerationService.ts
export interface ReportMetadata {  // ← owns the type
  id: string
  format: string
  parameters: { key: string; value: string }[]
}

export class ReportGenerationService {
  constructor(
    private excelHandler: ExcelReportHandler,      // ← imports handlers
    private pdfHandler: PdfReportHandler
  ) {}
}

// ExcelReportHandler.ts
import { ReportMetadata } from '../ReportGenerationService' // ← cycle!

export class ExcelReportHandler {
  async handle(meta: ReportMetadata) { ... }
}
```

### After (fixed)
```typescript
// reports/reports.types.ts  ← NEW FILE
export interface ReportMetadata {
  id: string
  format: string
  parameters: { key: string; value: string }[]
}

// ReportGenerationService.ts
import { ReportMetadata } from './reports/reports.types' // ← no longer owns it

// ExcelReportHandler.ts
import { ReportMetadata } from './reports.types' // ← imports from types file
```

---

## Event Wiring — Detailed Example

### Before (broken)
```typescript
// ConnectionManager.ts
import { EventWiringService } from './EventWiringService' // ← cycle!

export class ConnectionManager {
  private wiringService: EventWiringService

  async connect() {
    const socket = await createSocket()
    this.wiringService.wire(socket)  // ← directly calls wiring service
  }
}

// EventWiringService.ts
import { ConnectionManager } from './ConnectionManager' // ← cycle closes

export class EventWiringService {
  constructor(private connectionManager: ConnectionManager) {}

  wire(socket: Socket) {
    socket.on('data', ...)
    socket.on('error', ...)
  }
}
```

### After (fixed)
```typescript
// ConnectionManager.ts  ← extends EventEmitter, no import of wiring service
import { EventEmitter } from 'events'

export class ConnectionManager extends EventEmitter {
  async connect() {
    const socket = await createSocket()
    this.emit('socket:ready', socket)  // ← emits, never calls wiring directly
  }
}

// EventWiringService.ts  ← subscribes, never imports connection manager class
export class EventWiringService {
  register(connectionManager: EventEmitter) {  // ← typed as EventEmitter, not concrete class
    connectionManager.on('socket:ready', (socket) => {
      socket.on('data', ...)
      socket.on('error', ...)
    })
  }
}

// ServiceContainer.ts  ← owns the wiring
const connectionManager = new ConnectionManager()
const wiringService = new EventWiringService()
wiringService.register(connectionManager)  // ← wired here, no mutual imports
```

---

## Subscriber Pattern — Multiple Initialization Cycles

When multiple subscribers all import ServiceContainer, fix them all in one pass:

### Pattern: Extract specific deps per subscriber

```typescript
// Before: every subscriber receives full container
class DbLoggerSubscriber {
  constructor(private services: ServiceContainer) {}
  register(bus: EventBus) {
    bus.on('user:created', async (user) => {
      await this.services.logRepo.insert(user)   // only uses logRepo
      await this.services.userRepo.update(user)  // and userRepo
    })
  }
}

// After: subscriber declares exactly what it needs
class DbLoggerSubscriber {
  constructor(
    private logRepo: ILogRepository,
    private userRepo: IUserRepository
  ) {}
  register(bus: IEventBus) {
    bus.on('user:created', async (user) => {
      await this.logRepo.insert(user)
      await this.userRepo.update(user)
    })
  }
}
```

### Pattern: Update createSubscribers factory

```typescript
// Before
export function createSubscribers(services: ServiceContainer): IEventSubscriber[] {
  return [
    new DbLoggerSubscriber(services),
    new NotificationSubscriber(services),
    new UIBroadcastSubscriber(services),
  ]
}

// After — each subscriber gets only what it needs
export function createSubscribers(deps: {
  logRepo: ILogRepository
  userRepo: IUserRepository
  eventBus: IEventBus
  notificationService: INotificationService
}): IEventSubscriber[] {
  return [
    new DbLoggerSubscriber(deps.logRepo, deps.userRepo),
    new NotificationSubscriber(deps.notificationService),
    new UIBroadcastSubscriber(deps.eventBus),
  ]
}
```