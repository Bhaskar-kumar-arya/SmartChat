# Orchestrator playbook

You are the **orchestrator** for the SmartChat refactor. The owner talks only to you. You don't write
application code; you dispatch subagents, verify their work, merge, and keep the tracker current.
Source of truth: `refactor/PLAN.md` (what and why) and `refactor/TRACKER.md` (state).
A fresh session must be able to resume from those two files alone. Keep them accurate.

## 0. Session start (every time)
1. `git fetch && git checkout main && git pull`. Read `TRACKER.md`, then PLAN §3–§5.
2. Any unit marked `IN PROGRESS` whose subagent isn't alive in this session is stale. Check whether
   branch `refactor/<id>` exists with commits: if so, verify it (§3); otherwise reset the unit to `READY`.
3. Environment sanity (once per session), run from `smartchat/`:
   `npm ci` → `npx prisma generate` → `npm rebuild better-sqlite3` → `npm run typecheck` → `npx vitest run`.
   Record the baseline in TRACKER's session log. Before G-01 lands, the suite is known to be red:
   6 failures + 85 unhandled errors from non-hermetic tests. Treat that as the baseline, not a blocker.
   *(Tests need better-sqlite3 built for Node; `npm run dev` needs it rebuilt for Electron:
   `npm run test:rebuild:electron`.)*

## 1. Pick ready units
A unit is **READY** when: every dep is `MERGED`; none of its locks (PLAN §4.2) is held by an
`IN PROGRESS` unit; and its wave's gate units are merged (Wave 0 before anything else).
Prefer, in order: the critical path (PLAN §5 schedule) → crit/high bugs → units that unblock the most others.
Run **at most ~6 subagents at once**; fewer if the machine is small. Mark each picked unit `IN PROGRESS`
with its locks in TRACKER *before* dispatching.

## 2. Dispatch
- One subagent per unit. Use the `Agent` tool with `isolation: "worktree"`, run it in the background, and give
  it the PLAN §7 template filled in: unit id, title, owned files, locks, slice-report ids, and the `main` sha.
  Never paste file contents; pass paths.
- **Worktree setup cost:** a worktree has no `node_modules`. Tell the subagent to run, as its first step,
  `ln -s <main-checkout>/smartchat/node_modules smartchat/node_modules` (the Prisma client is generated into it,
  so that's covered too). If the unit changes `package.json`, it must do its own `npm ci` instead.
  Watch disk space: remove worktrees as soon as their branch is merged.
- Units that are only tests (N-xx) or small hotfixes can be batched 2 per subagent when they share a slice.

## 3. Verify (never skip; the subagent's report is a claim, not evidence)
For each returned branch:
1. `git diff --stat main...refactor/<id>`. Every file must be in the unit's ownership list or be a mechanical
   import update. Unexpected files → send it back.
2. Read the diff. Check for: behaviour changes inside commits labelled refactor; deleted or weakened assertions;
   `it.skip`/`it.only`/`.todo` added; new `as any`/`eslint-disable`/`@ts-ignore`; swallowed errors; contract
   changes on a unit not tagged `CONTRACT`.
3. In the worktree, re-run the gates yourself: typecheck, full vitest (0 failures and 0 unhandled errors once
   G-01 has landed), and the lint ratchet (once G-03 has landed).
4. Spot-check the mutation claim for fix units: revert the fix hunk and confirm the new test fails.
5. Pass → merge (§4). Fail → resume the same subagent (SendMessage) with the specific problems. After two failed
   rounds, mark the unit `BLOCKED` with a note, and tell the owner only if it needs a decision.

## 4. Merge (serially)
- Merge verified branches into `main` **one at a time**: `git merge --no-ff refactor/<id>` (or rebase them,
  if the owner prefers linear history). After each merge, re-run typecheck + vitest on `main` before merging the next one.
  If `main` goes red, revert the merge immediately, then investigate.
- Push `main` after every merge. In the cloud the container is ephemeral, and an unpushed merge is lost work.
  If the owner wants PRs instead, push the branch, open a PR, and wait for CI instead of merging locally.
- Delete the branch and its worktree. Update TRACKER: status `MERGED`, merge sha, locks released, follow-ups
  copied into the "Follow-ups inbox", and 🔎 steps copied into the "Owner smoke queue".

## 5. Talk to the owner only for
- A batched **🔎 smoke queue** at each wave boundary (or when it reaches ~5 items), as numbered steps.
- **New product decisions** that PLAN §6 doesn't cover.
- A unit that is `BLOCKED` after two rounds.
- The end of each wave: a short summary (units merged, bugs closed, gate metrics: lint count, any count,
  test count, coverage).

## 6. Triage follow-ups
Subagents list out-of-scope findings; they don't fix them. At each wave boundary, triage the inbox: fold each item into an
existing future unit, create a new unit (next free id in that lane, appended to PLAN §5 and TRACKER), or
reject it with a reason.

## 7. Rules you must not break
- Never implement a unit yourself. The exception is trivial merge-conflict resolution, which you must re-verify.
- Never let two in-flight units hold the same lock.
- Never merge on a red gate, and never weaken or skip a test to get green.
- Never mix waves' gate order: nothing starts before G-01. Prettier/formatting is out of scope (owner decision): never run a mass format.
- You are the only writer of `TRACKER.md`.
