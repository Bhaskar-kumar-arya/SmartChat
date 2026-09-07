# Frontend Bug Audit Tracker

Single source of truth. Read [`README.md`](./README.md) for the session protocol
and the frontend bug-class checklist. Update the status table and append findings
here. Fix phase → [`FIX_PLAN.md`](./FIX_PLAN.md) (created once auditing is far
enough along).

Statuses: `TODO` · `IN PROGRESS` · `DONE (<n> findings)` · `BLOCKED`

## Status

| # | Slice | Status | Last touched | Notes |
|---|-------|--------|--------------|-------|
| F1 | Preload bridge & IPC surface | TODO | — | trust boundary — start here |
| F2 | App shell, providers, contributions | TODO | — | |
| F3 | Chat data hooks (backend event sync) | TODO | — | highest bug density expected — async races, event lifecycle |
| F4 | Chat list & layout & nav UI | TODO | — | |
| F5 | Message view & rendering | TODO | — | check markdown / media URL / keys / virtualization |
| F6 | Message input & composition | TODO | — | mentions, file queue, audio recorder |
| F7 | Search UI | TODO | — | search-as-you-type out-of-order responses |
| F8 | AI chat UI | TODO | — | streaming abort/race, citation markdown XSS |
| F9 | Extensions / plugins UI | TODO | — | webview sandbox, plugin-supplied content |
| F10 | Overlays & modals | TODO | — | focus trap, portal cleanup, scroll lock |
| F11 | Common components & utils | TODO | — | |
| F12 | Cross-cutting pass | TODO | — | do only after F1–F11 |

## Summary counts

| Severity | Count |
|----------|-------|
| crit | 0 |
| high | 0 |
| med  | 0 |
| low  | 0 |

## Baseline (record before fix phase)

- `npm run typecheck:web` — not yet recorded
- `npm run test:run -- src/renderer` — not yet recorded (expected ~319 pass)

---

# Findings

## Slice F1 — Preload bridge & IPC surface
_none yet_

## Slice F2 — App shell, providers, contributions
_none yet_

## Slice F3 — Chat data hooks
_none yet_

## Slice F4 — Chat list & layout & nav UI
_none yet_

## Slice F5 — Message view & rendering
_none yet_

## Slice F6 — Message input & composition
_none yet_

## Slice F7 — Search UI
_none yet_

## Slice F8 — AI chat UI
_none yet_

## Slice F9 — Extensions / plugins UI
_none yet_

## Slice F10 — Overlays & modals
_none yet_

## Slice F11 — Common components & utils
_none yet_

## Slice F12 — Cross-cutting pass
_none yet_
