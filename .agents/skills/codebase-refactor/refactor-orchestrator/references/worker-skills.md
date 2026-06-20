# Worker Skills Reference

Each worker agent is stateless. They receive a prompt, execute one task, and report back.
This file describes what each skill does, when to invoke it, and what to expect in the report.

---

## circular-deps

**Purpose:** Fixes circular import cycles in TypeScript codebases.
**Invoked at:** Stage 1
**Has file tools:** Yes (read + write)
**Has terminal:** Yes

**What it does:**
- Reads each file involved in a cycle
- Applies the correct fix pattern per cycle category
- Creates new shared type files when needed
- Updates imports across affected files

**Expected report fields:**
- `files_changed`: list of modified files
- `files_created`: list of new files (e.g. shared types files)
- `verification`: result of madge --circular re-run
- `blockers`: any cycles it could not resolve

**Common blocker:** A cycle where a concrete class and its interface both import from a third
file that itself imports one of them. Escalate to orchestrator for manual analysis.

---

## solid-audit

**Purpose:** Reads the codebase and produces audit.md — the SOLID violation report and phase plan.
**Invoked at:** Stage 2
**Has file tools:** Yes (read + write)
**Has terminal:** Yes (for fan-in analysis)

**What it does:**
- Reads every file in the fan-in list
- For each file: identifies responsibilities, evaluates each SOLID principle, proposes fixes
- Organizes fixes into phases with verification commands
- Writes audit.md with three sections: violations, phase plan, completion tracker

**Expected report fields:**
- `audit_md_path`: where audit.md was written
- `files_audited`: count
- `violations_found`: count
- `phases_planned`: count
- `blockers`: files it could not read or analyze

**Quality check:** The orchestrator must read audit.md and verify it is not superficial.
Each phase must name specific files, not vague categories.

---

## type-safety-fix

**Purpose:** Fixes type-safety and async-safety smells without structural changes.
**Invoked at:** Stage 4a
**Has file tools:** Yes (read + write)
**Has terminal:** Yes (for tsc verification)

**What it does:**
- Replaces `as any` / `: any` with proper types or `unknown` + type guards
- Replaces `!.` with `?.` + `??` fallbacks
- Adds error logging to empty catch blocks
- Wraps floating promises with `.catch` handlers or `await`
- Adds explicit return types to public functions

**Expected report fields:**
- `files_changed`: list
- `violations_fixed`: object with counts per category
- `tsc_result`: pass/fail
- `remaining_issues`: anything it could not safely fix automatically
- `blockers`: any issues

**What it must NOT do:**
- Rename or move anything
- Change function signatures beyond adding return types
- Make structural decisions (that is Stage 3's job)

---

## solid-fix

**Purpose:** Executes one phase of the SOLID refactoring plan from audit.md.
**Invoked at:** Stage 3 (once per phase)
**Has file tools:** Yes (read + write)
**Has terminal:** Yes (for tsc verification)

**What it does:**
- Reads audit.md to understand the full plan and its assigned phase
- Executes the fixes described in its phase only
- Marks the phase complete in audit.md
- Runs tsc to verify

**Expected report fields:**
- `phase_completed`: phase number
- `files_changed`: list
- `files_created`: list
- `interfaces_extracted`: list of new interface names
- `tsc_result`: pass/fail
- `audit_md_updated`: yes/no
- `blockers`: any issues

**Critical rule:** If a worker tries to fix something outside its phase (scope creep),
its changes must be reverted. The orchestrator enforces phase boundaries strictly.

**When a phase is High effort:** The orchestrator may split it into two sub-prompts:
- Sub-prompt A: interface extraction only
- Sub-prompt B: wiring and injection only
This prevents context window exhaustion on large files.

---

## smell-fix

**Purpose:** Fixes structural code quality smells after SOLID compliance is established.
**Invoked at:** Stage 4b
**Has file tools:** Yes (read + write)
**Has terminal:** Yes (for tsc verification)

**What it does:**
- Extracts long methods into named sub-functions
- Replaces magic strings/numbers with named constants
- Flattens deep nesting with guard clauses and early returns
- Standardizes error handling strategy per service

**Expected report fields:**
- `files_changed`: list
- `smells_fixed`: object with counts per category
- `tsc_result`: pass/fail
- `blockers`: anything it could not safely fix

**What it must NOT do:**
- Change business logic
- Move code between files
- Rename public interfaces or methods

---

## docs

**Purpose:** Produces architecture documentation from the finalized codebase.
**Invoked at:** Stage 5
**Has file tools:** Yes (read + write)
**Has terminal:** No

**What it does:**
- Reads all barrel files, interfaces, ServiceContainer, and audit.md
- Produces ADR.md, modules.md, and ai-context.md in docs/architecture/

**Expected report fields:**
- `files_created`: list
- `adr_decisions_documented`: count
- `modules_mapped`: count
- `ai_context_line_count`: number (must be ≤ 100)
- `blockers`: any issues

**Quality check:** ai-context.md must be dense and scannable — not a wall of prose.
If it exceeds 100 lines, the orchestrator requests a condensed revision.