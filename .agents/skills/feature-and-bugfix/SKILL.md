---
name: feature-and-bugfix
description: |
  Enforces strict type safety, SOLID principles,DRY principles, clean folder structures, and layered boundaries
  when implementing new features or fixing bugs.
version: 1.0.0
tags:
  - development
  - feature-implementation
  - bug-fix
  - architecture
---

# Feature & Bugfix Guidelines

## Overview
This skill defines the rules, principles, and architectural standards that must be kept in mind when writing new code or editing existing code to implement features or fix bugs.

> [!IMPORTANT]
> **CRITICAL INSTRUCTIONS FOR AI AGENT (CODER):**
> You are strictly bound by the rules in this document. When writing or refactoring code, you MUST:
> 1. **Zero Unsafe Types:** Never use `any` or `as any`. Use type-guarding or interface assertions instead.
> 2. **No Swallowed Errors:** Never use empty `.catch(() => {})` or empty `catch (e) {}` blocks. Every catch block must actively log or handle the error.
> 3. **SRP & Proactive File Splitting:** Avoid generating or expanding monolithic files. If your code changes are going to make a file grow significantly or take on new responsibilities, you MUST proactively split the logic into separate, cohesive files/modules within the same session. Do not postpone refactoring.
> 4. **No Speculative Coding:** Only implement what is requested; do not add placeholder logic or future abstractions.
> Before submitting your final code, double-check your implementation against this checklist. Failure to comply with these rules is unacceptable.
> 5. **File & Folder Structure:** if files in a folder are increased, split them into separate files/modules if meaningful. Do it within the same session. Do not postponse refactoring.
---

## Key Rules to Keep in Mind

### 1. SOLID Principles
- **Single Responsibility (SRP):** Each module, class, or function must have only one reason to change. Keep UI rendering components decoupled from side-effect or state management logic. Split large files into focused domain helpers. Monitor file size as a heuristic indicator for SRP violations; if a change or new feature will make a file grow significantly or accumulate unrelated responsibilities, split it proactively into separate files/modules in the same session.
- **Open/Closed (OCP):** Code must be open for extension but closed for modification. Use polymorphism, interfaces, and strategy/factory patterns instead of expanding large switch-case or if-else blocks.
- **Liskov Substitution (LSP):** Ensure subclasses or implementations can stand in for their interfaces without breaking client behavior. Favor composition over inheritance.
- **Interface Segregation (ISP):** Clients must not be forced to depend on methods they do not use. Design small, specific, cohesive interfaces rather than giant interfaces.
- **Dependency Inversion (DIP):** Depend on abstractions, not concretions. Inject dependencies into services and classes instead of hardcoding raw class or client instantiations.

### 2. Strict Type Safety
- **No `any` or `as any`:** The use of `any` or `as any` is strictly forbidden. If a type is complex or unknown (e.g., third-party library objects from Baileys), type it as `unknown` and use runtime type guards, schema validations, or declare a proper, narrowed local interface.
- **Exhaustiveness Checks:** Use Discriminated Unions for states and actions, and ensure all branches in switches are handled by assigning the fallthrough/default case to a variable typed as `never`.
- **Avoid Non-Null Assertions (`!`):** Never force-override the compiler. Use optional chaining (`?.`) and nullish coalescing default values (`??`) instead.

### 3. File & Folder Organization
- **Feature-Based Layout:** Group code files by functional domain (e.g., `billing`, `inventory`, `users`) instead of technical layers (e.g., separating all controllers, views, models globally).
- **Layered Boundaries:** Keep UI views isolated from business logic services and core infrastructure libraries (like databases, filesystem adapters, and external API integrations).
- **Barrel Files:** Use `index.ts` files to export public interfaces, but avoid circular references when cross-importing them.

### 4. Implementation & Bug Fixing Rules
- **No Speculative Abstractions (YAGNI):** Do not write code, functions, or configurations for future requirements. Only implement what is requested by the active task.
- **Isolate Root Causes:** Do not apply patch-work fixes (like wrapping buggy paths in generic try-catch blocks or speculative null-checks) that hide the symptom. Identify and repair the underlying state or logic issue.
- **Design & Pipeline Suitability:** Critically evaluate the design, pipeline, or pattern selected for implementation. Ensure you choose the most optimal, decoupled, and robust architectural pattern or data pipeline (e.g., event streams, queues, state machines, pub/sub, provider strategies) for the task rather than simply picking the easiest path.
- **Zero TypeScript Warnings:** The application must compile with zero compiler warnings or errors after code changes.
- **No Swallowed Errors (try-catch & Promises):** Every `try-catch` block and Promise `.catch()` block must actively handle and log the error (e.g., using `logger.error` or `console.error`). Empty `try-catch` blocks and empty Promise catches like `.catch(() => {})` are strictly forbidden.
- **Leverage logs to find bugs:** If you are unsure about the root cause of a bug, use `console.log` or `console.error` to inspect the values of variables and trace the execution flow instead of making pure assumptions. Make sure you remove them after you find the root cause.

 