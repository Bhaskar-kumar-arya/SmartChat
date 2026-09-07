# Backend Bug Audit — Pass 2 — Tracker

Single source of truth for this audit. Read [`README.md`](./README.md) first
(protocol + full checklist + slice map). Independent of `../bug-audit/` — no
need to read that folder.

Statuses: `TODO` · `IN PROGRESS` · `DONE (<n> findings)` · `BLOCKED`

## Status

| # | Slice | Status | Last touched | Notes |
|---|-------|--------|--------------|-------|
| 1 | WhatsApp worker & socket | IN PROGRESS | 2026-09-07 | |
| 2 | Message pipeline | TODO | — | |
| 3 | WhatsApp service & subscribers | TODO | — | |
| 4 | Chats & sync | TODO | — | |
| 5 | Contacts | TODO | — | |
| 6 | AI (providers, mentions, citations, prompts) | TODO | — | |
| 7 | Kernel API modules & router | TODO | — | |
| 8 | Kernel plugins, contributions, permissions | TODO | — | |
| 9 | Kernel storage, channels, ipc, ui | TODO | — | |
| 10 | App IPC & auth | TODO | — | |
| 11 | apiServer, search, notification, calls, audio | TODO | — | |
| 12 | SDK, tools, data wipe, domain, db, protocol | TODO | — | |
| 13 | Cross-cutting pass | TODO | — | do only after 1–12 |

## Summary counts

| Severity | Count |
|----------|-------|
| crit | 0 |
| high | 0 |
| med  | 0 |
| low  | 0 |

---

# Findings

## Slice 1 — WhatsApp worker & socket
_none yet_

## Slice 2 — Message pipeline
_none yet_

## Slice 3 — WhatsApp service & subscribers
_none yet_

## Slice 4 — Chats & sync
_none yet_

## Slice 5 — Contacts
_none yet_

## Slice 6 — AI
_none yet_

## Slice 7 — Kernel API modules & router
_none yet_

## Slice 8 — Kernel plugins, contributions, permissions
_none yet_

## Slice 9 — Kernel storage, channels, ipc, ui
_none yet_

## Slice 10 — App IPC & auth
_none yet_

## Slice 11 — apiServer, search, notification, calls, audio
_none yet_

## Slice 12 — SDK, tools, data wipe, domain, db, protocol
_none yet_

## Slice 13 — Cross-cutting pass
_none yet_

---

# Fix phase (after audit)

Not started. When it starts: commit directly to `main`, test-first where
feasible, manually verify in the running app for IPC/socket/lifecycle bugs,
record a test/typecheck baseline first. See `FIX_PLAN.md`.
