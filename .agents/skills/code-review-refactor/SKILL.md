---
name: code-review-refactor
description: |
  Enforces clean code architecture, SOLID principles, strict type safety,
  proper file/folder organization, and sound software design patterns during code review and refactoring.
  Use when analyzing project structures, introducing new components, refactoring legacy code, or auditing type systems.
version: 1.0.0
tags:
  - architecture
  - solid
  - typesafety
  - clean-code
---

# Clean Code, SOLID & Architectural Principles Skill

## Overview
This skill provides the AI agent with a rigorous framework to audit, review, and design codebases according to modern software engineering principles. It prioritizes decoupled architectures, strict compile-time safety, modular file layouts, and strict adherence to SOLID design patterns.

---

## Pillar 1: SOLID Principles in Practice

When reviewing or refactoring code, enforce the following five object-oriented and functional design principles:

### 1. Single Responsibility Principle (SRP)
- **Rule:** A module, class, or function should have one, and only one, reason to change.
- **Application:** 
  - Extract database queries out of API routing/controllers into dedicated **Repositories** or **Services**.
  - Separate UI rendering markup from state management. Use custom hooks (e.g., `useDataFetch.ts`) for complex side-effects, keeping the UI component focused on rendering.
  - Avoid "God files" or helper files (like a general `utils.ts` that grows indefinitely). Split them into domain-specific utilities (e.g., `dateUtils.ts`, `validationUtils.ts`).

### 2. Open/Closed Principle (OCP)
- **Rule:** Software entities should be open for extension, but closed for modification.
- **Application:**
  - Avoid switch-case tables or if-else chains that must be updated every time a new feature or type is added.
  - Use **polymorphism** or **strategy/factory patterns**. For instance, if supporting multiple payment processors (e.g., Stripe, PayPal), define an `IPaymentProcessor` interface. Adding a new processor should mean writing a new class implementing the interface, not modifying the core transaction engine.

### 3. Liskov Substitution Principle (LSP)
- **Rule:** Objects of a superclass should be replaceable with objects of its subclasses without breaking the application.
- **Application:**
  - Avoid throwing `UnsupportedOperationException` in derived implementations. If a subclass cannot implement all methods of an interface, the interface is too broad (violates ISP).
  - Favor **composition over inheritance** to prevent subclasses from inheriting behavior they do not need.

### 4. Interface Segregation Principle (ISP)
- **Rule:** Clients should not be forced to depend on methods they do not use.
- **Application:**
  - Design small, cohesive, role-specific interfaces rather than large, general-purpose ones.
  - In TypeScript, prefer dividing a giant database model interface into smaller sub-interfaces or utility types (e.g., `Pick<User, 'id' | 'email'>`, `Omit<User, 'password'>`) for specific function parameters.

### 5. Dependency Inversion Principle (DIP)
- **Rule:** Depend on abstractions (interfaces), not on concretions (implementations).
- **Application:**
  - High-level business logic services must not directly instantiate database clients (like a raw Prisma instance) or external SDKs. Instead, inject the dependencies through constructor parameters or function arguments.
  - This decoupling allows for mock implementations during unit testing.

---

## Pillar 2: Strict Type Safety

TypeScript should act as a compile-time shield. Do not bypass the type compiler.

- **No `any` or `as any`:** The use of `any` is a critical safety bypass. If a type is genuinely unknown, use `unknown` and narrow it down with runtime **Type Guards** (`is` predicate) or assertion functions.
- **Type Discrimination:** Use Discriminated Unions for state management and API responses:
  ```typescript
  type AsyncState<T> =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'success'; data: T }
    | { status: 'error'; error: Error };
  ```
- **Avoid Non-Null Assertions (`!`):** Do not override the compiler with `object!.property`. Use optional chaining (`object?.property`) or nullish coalescing default fallbacks (`object?.property ?? defaultValue`).
- **Exhaustiveness Checks:** Ensure all branches are handled in switch-cases by assigning the fallthrough case to `never`:
  ```typescript
  function handleAction(action: Action) {
    switch (action.type) {
      case 'SEND': return send();
      case 'RECEIVE': return receive();
      default: {
        const _exhaustiveCheck: never = action;
        return _exhaustiveCheck;
      }
    }
  }
  ```

---

## Pillar 3: File & Folder Organization

A project's directory structure should reflect its architectural boundaries and domain model.

### 1. Domain-Driven / Feature-Based Layout
- Group files by feature/domain (e.g., `billing`, `inventory`, `users`, `auth`) rather than organizing entirely by technical type (`controllers`, `models`, `views`).
- **Standard Feature Folder Layout:**
  ```
  src/
  ├── core/                  # Core domain logic
  │   └── services/
  │       ├── billing/
  │       │   ├── BillingService.ts
  │       │   ├── BillingRepository.ts
  │       │   └── types.ts
  └── ui/                    # UI presentation layer
      └── components/
          └── billing/
              ├── InvoiceCard.tsx
              ├── InvoiceCard.css
              └── useInvoice.ts
  ```

### 2. Architecture Boundary Isolation
- **IPC Segregation:** Keep a strict boundary between the Main (node environment) and Renderer (browser environment) processes. 
- Renderer components must *never* import main process files or directly interact with database modules (e.g., database clients or ORMs). All data fetch/mutation requests must go through typed IPC bridges (via a preload script).

### 3. Barrel Files (`index.ts`)
- Use `index.ts` files to export public interfaces of a directory, keeping implementation details private.
- **Warning:** Avoid circular dependencies caused by cross-importing barrel files. Only import what is needed from specific source files if circular chains are detected.

---

## Pillar 4: Architecture & Design Patterns

Ensure the application implements a clean, layered architectural design:

1.  **Presentation Layer (UI/Client):** User interface components. Handles rendering, user interaction, and component-local state.
2.  **Application Service Layer:** Orchestrates business logic, use cases, and coordinates calls to database layers, services, and third-party integrations.
3.  **Infrastructure Layer:** Adapters for database clients (ORMs), file systems, network requests, and external APIs (e.g., SMS gateways, cloud storage providers).

### 4. Pipeline & Design Evaluation
- **Critical Evaluation:** Do not just verify that code compiles or runs. Critically analyze the design, pipeline, or pattern selected to achieve the task.
- **Architectural Match:** Determine if there is a more appropriate architectural pattern or data pipeline (e.g. event streams, queues, state machines, pub/sub, provider strategies) that would make the implementation cleaner, more decoupled, or more robust.

---

## Verification & Auditing Checklist

When reviewing code, ask yourself:

- [ ] **SRP:** Does this class/function do more than one thing? If yes, split it.
- [ ] **DIP:** Is this service hardcoding a concrete class instantiation? Can it be injected?
- [ ] **Any-Free:** Are there instances of `any` or forced type casting (`as SomeType`) that can be replaced with proper type definitions or type guards?
- [ ] **Location:** Is this new file placed in the correct domain/layer directory?
- [ ] **Clean Boundary:** Does the UI code call backend libraries directly, or does it properly route through the IPC bridge/preload?
- [ ] **Pipeline & Design Check:** Is the current processing pipeline or design pattern the most optimal, or is there a better architectural alternative to solve this problem?
