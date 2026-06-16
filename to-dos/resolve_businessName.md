# Implementation Plan - WhatsApp Business Identity Resolution

This plan details how to resolve and synchronize verified business names for WhatsApp Business accounts, preventing the display of raw LID numbers in the user interface.

## User Review Required

> [!IMPORTANT]
> The active resolution queries the WhatsApp server using the socket instance `sock.getBusinessProfile(jid)`. To prevent rate-limiting or blocking:
> - Active resolution requests will be throttled and run sequentially with a small delay (e.g., 500ms) between JIDs.
> - Queries are only performed for DM chats that are bare LIDs and have no cached name.

---

## Proposed Changes

### main

#### [MODIFY] [ContactService.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/services/contacts/ContactService.ts)

- Update `upsertContact` to safely update fields without write-induced erasures:
  - Verify that `newNotify` and `newVerifiedName` are not null/empty before updating.
- Implement `resolveMissingBusinessNames(sock: WASocket)`:
  - Query all DM chats in the database where the JID ends with `@lid` and the associated `Identity` has `displayName` and `verifiedName` both set to `null`.
  - For each JID, sequentially request `sock.getBusinessProfile(jid)`.
  - If a profile name is found, upsert the contact to persist `verifiedName`.
- Implement `resolveBusinessProfileLazy(jid: string, sock: WASocket)`:
  - A fire-and-forget helper to resolve a business profile on-demand with local deduplication (so we don't query the same JID multiple times in parallel).
- Modify `batchResolveNames` to lazily trigger `resolveBusinessProfileLazy` when a LID JID fallback is encountered.

---

#### [MODIFY] [HistorySyncManager.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/services/whatsapp/HistorySyncManager.ts)

- In `finishSync`, right after the identity deduplication step, trigger:
  ```typescript
  await this.services.contactService.resolveMissingBusinessNames(sock).catch(err => {
    console.warn('[finishSync] resolveMissingBusinessNames error:', err)
  })
  ```

---

#### [MODIFY] [MessageService.ts](file:///c:/Users/prith/Desktop/smartChat/smartchat/src/main/services/messages/MessageService.ts)

- In `processMessage`, extract `msg.verifiedBizName`.
- If `msg.verifiedBizName` is present, pass it to `contactService.upsertContact` as `verifiedName` so that real-time business messages passively update the name cache:
  ```typescript
  if (participantString && (msg.pushName || msg.verifiedBizName)) {
    await this.contactService.upsertContact({
      id: participantString,
      name: msg.pushName || null,
      notify: msg.pushName || null,
      verifiedName: msg.verifiedBizName || null
    }, { overwriteName: false }).catch(() => {})
  }
  ```

---

## Verification Plan

### Manual Verification
- Run a manual validation script or launch the application.
- Verify that DM chats with LIDs like `44354446086346@lid` are correctly resolved to their verified names.
- Inspect the `dev.db` database to ensure the `Identity` table has `verifiedName` populated and that existing names are not wiped out.
