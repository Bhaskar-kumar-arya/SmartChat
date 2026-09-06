# Bug Audit Tracker

Single source of truth. Read [`README.md`](./README.md) for the session protocol
and the bug-class checklist. Update the status table and append findings here.

Statuses: `TODO` · `IN PROGRESS` · `DONE (<n> findings)` · `BLOCKED`

## Status

| # | Slice | Status | Last touched | Notes |
|---|-------|--------|--------------|-------|
| 1 | WhatsApp worker & socket | IN PROGRESS | 2026-09-06 | scrutinize event-subscription-before-connect (recent fix cf7a042) |
| 2 | Message pipeline | TODO | — | largest slice (~55 files); may need 2 sessions |
| 3 | WhatsApp service & subscribers | TODO | — | recent OTP relay + queue-subscriptions fix |
| 4 | Chats & sync | TODO | — | |
| 5 | Contacts | TODO | — | |
| 6 | AI (providers, mentions, citations) | TODO | — | ~45 files; may need 2 sessions |
| 7 | Kernel API modules & router | TODO | — | |
| 8 | Kernel plugins, contributions, permissions | TODO | — | |
| 9 | Kernel storage, channels, ipc, ui | TODO | — | |
| 10 | App IPC & auth | TODO | — | trust boundary |
| 11 | apiServer, search, notification, calls, audio | TODO | — | HTTP surface = apiServer |
| 12 | SDK, tools, data wipe, domain, db, protocol | TODO | — | DataWipeService = data-loss risk |
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

Once slices are audited, triage findings here (which to fix, in what order).
Not started.
