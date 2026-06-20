# Module Boundary Template — Worked Example

This is a reference example showing how a well-written module entry should look.
Adapt the structure for your project's domain folders.

---

## `services/orders/`

**Purpose:** Manages order lifecycle — creation, status transitions, and query.

**Public exports** (`index.ts`):
- `IOrderService` — orchestrates order workflows
- `IOrderRepository` — data access contract for order persistence
- `IOrderQueryService` — read-only query interface for order listings
- `OrderStatus`, `OrderCreateInput`, `OrderSummary` — shared domain types

**Internal only** (never import from outside this folder):
- `OrderService.ts` — concrete orchestration implementation
- `OrderRepository.ts` — concrete Prisma-based data access
- `OrderQueryService.ts` — concrete read-optimized queries
- `helpers/OrderValidator.ts` — input validation logic
- `helpers/OrderStatusMachine.ts` — state transition rules

**Consumes from other modules:**
- `services/users/` — `IUserService` for buyer/seller resolution
- `services/notifications/` — `INotificationService` for order event alerts
- `services/payments/` — `IPaymentService` for payment initiation

**Consumed by:**
- `services/analytics/` — uses `IOrderQueryService` for reporting
- `ipc/` — uses `IOrderService` for UI-triggered order actions
- `services/shipping/` — uses `IOrderRepository` (read) for fulfillment
