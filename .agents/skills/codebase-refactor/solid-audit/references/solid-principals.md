# SOLID Principles — Pass/Fail Criteria

Precise evaluation criteria for each principle. Use these to make binary PASS/VIOLATION
decisions during auditing. When in doubt, mark VIOLATION — false positives are caught in
review; false negatives become technical debt.

---

## S — Single Responsibility Principle

**Definition:** A class/module should have only one reason to change.
"Reason to change" means: a change in one domain concept forces an edit to this file.

### VIOLATION signals
- The file's purpose requires "and" to describe: "parses messages *and* saves them"
- File exceeds 300 lines (strong signal of multiple concerns)
- The class has methods that fall into 2+ of these buckets:
  - Data access (DB reads/writes)
  - Business logic / orchestration
  - Data transformation / parsing
  - I/O (file system, network, sockets)
  - Event publishing/subscribing
  - Display/formatting for UI
- A service file directly contains Prisma/SQL/ORM calls
- A repository file contains business rules or event emissions

### PASS signals
- Every method serves the same single concern
- You can name the file's purpose in 3-5 words without "and"
- The file has one clear "reason to change" (e.g. only changes if the DB schema changes)

---

## O — Open/Closed Principle

**Definition:** Open for extension, closed for modification.
Adding a new variant should not require editing existing classes.

### VIOLATION signals
- A `switch(type)` or `if/else if` chain where adding a new type requires editing the chain
- A hardcoded array of type strings inside a service: `['text', 'image', 'video']`
- A comment like `// add new message type here`
- Adding a new provider/formatter/handler requires editing more than one existing file
- No strategy/registry pattern exists for something with 3+ known variants

### PASS signals
- New variants are added by creating a new file and registering it, not editing existing ones
- A strategy registry or handler array is populated from outside the class
- The class delegates type-specific behavior via an interface, not a switch

---

## L — Liskov Substitution Principle

**Definition:** Subtypes must be substitutable for their base types without altering correctness.

### VIOLATION signals
- A subclass overrides a method with an empty body or throws `NotImplementedException`
- A subclass narrows the contract: the parent says `save()` never throws; the subclass does
- Code does `if (instance instanceof ConcreteClass)` to add special-case behavior
- An interface method is implemented as a no-op in some implementors

### PASS signals (or N/A)
- No inheritance used — mark N/A
- All subclasses fully implement the parent contract
- No type-narrowing checks on subtypes in consuming code

---

## I — Interface Segregation Principle

**Definition:** Clients should not be forced to depend on methods they do not use.

### VIOLATION signals
- An interface has 8+ methods and different consumers only use different 2-3 method subsets
- A repository interface mixes read operations, write operations, AND search operations
- An implementor leaves some interface methods as empty stubs or throws
- A class takes a large interface as a constructor parameter but only calls 1-2 methods on it
- No interface exists at all for a class with multiple consumers (ISP smell — they'd be forced
  to depend on everything if an interface were added)

### PASS signals
- Every consumer of the interface uses most or all of its methods
- The interface has a single cohesive concern (reads only, writes only, search only)
- Implementors never stub out methods they "don't need"

---

## D — Dependency Inversion Principle

**Definition:** High-level modules should not depend on low-level modules.
Both should depend on abstractions. Abstractions should not depend on details.

### VIOLATION signals
- `import { PrismaClient } from '@prisma/client'` inside a Service file (not a Repository)
- `import { fs } from 'fs'` inside a Service or Domain file
- `private dep = new ConcreteClass()` inside a class body
- Constructor takes `ConcreteClass` instead of `IConcreteClass`
- A global singleton is exported and imported directly: `export const service = new ServiceClass()`
- The ServiceContainer type maps keys to concrete class types instead of interfaces
- `import { ServiceContainer }` inside any class that ServiceContainer itself creates

### PASS signals
- Constructor parameters are all interface types (prefixed with `I` or clearly abstract)
- No `new` calls inside class bodies (only in factories or ServiceContainer)
- Services import only from their own domain's type files and injected interfaces
- No direct ORM/DB client imports outside of Repository files

---

## Principle Interactions

Some violations compound each other. Flag these combinations explicitly:

| Combination | What it means |
|---|---|
| SRP + DIP violation | Class does too much AND creates its own deps — hardest to test |
| OCP + SRP violation | Hardcoded type chain inside a bloated class — highest refactor priority |
| ISP + DIP violation | Fat interface AND concrete dependency — creates rigid coupling across the codebase |
| SRP + ISP violation | Class has multiple responsibilities AND its interface exposes all of them |

When you see a combination, note it in the per-file report. Combined violations often
indicate that a file needs to be split into 2-3 classes, not just have its imports changed.