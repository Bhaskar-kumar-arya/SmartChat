# Guide to Handling WhatsApp System Stubs in Baileys

WhatsApp uses "Stub Messages" to represent background actions, notifications, and settings updates in a chat instead of standard text or media messages. In `@whiskeysockets/baileys`, these are represented by the `WAMessageStubType` enum and are delivered with an empty `message` body, but carry a `messageStubType` and an array of `messageStubParameters`.

This guide outlines the most useful stubs to listen to, their parameter structures, and how to implement a pipeline to store and render them.

---

## 1. Essential `WAMessageStubType` Reference

| Stub Enum / Name | Value | Description | `messageStubParameters` Format |
| :--- | :---: | :--- | :--- |
| **`REVOKE`** | `1` | A message was deleted by the sender. | `[]` (None; target message ID is in `msg.key.id`) |
| **`CIPHERTEXT`** | `2` | Squelched offline deletion fallback or decryption failure. | `['Message absent from node']` |
| **`CALL_MISSED_VOICE`** | `40` | Missed 1-on-1 voice call. | `[]` (Caller is `msg.key.participant` or `remoteJid`) |
| **`CALL_MISSED_VIDEO`** | `41` | Missed 1-on-1 video call. | `[]` |
| **`CALL_MISSED_GROUP_VOICE`** | `45` | Missed group voice call. | `[]` |
| **`CALL_MISSED_GROUP_VIDEO`** | `46` | Missed group video call. | `[]` |
| **`GROUP_CREATE`** | `20` | A group chat was created. | `[Creator JID]` |
| **`GROUP_CHANGE_SUBJECT`** | `21` | Group name/subject was changed. | `[New Subject, Actor JID]` |
| **`GROUP_CHANGE_ICON`** | `22` | Group profile icon changed. | `[Actor JID]` |
| **`GROUP_CHANGE_DESCRIPTION`** | `24` | Group description changed. | `[Actor JID]` |
| **`GROUP_PARTICIPANT_ADD`** | `27` | Participant(s) added to the group. | `[Added Participant JID(s)...]` |
| **`GROUP_PARTICIPANT_REMOVE`**| `28` | Participant(s) removed from the group. | `[Removed Participant JID(s)...]` |
| **`GROUP_PARTICIPANT_LEAVE`** | `32` | Participant left the group voluntarily. | `[Participant JID]` |
| **`GROUP_PARTICIPANT_PROMOTE`**| `29` | Participant made group admin. | `[Promoted Participant JID(s)...]` |
| **`GROUP_PARTICIPANT_DEMOTE`** | `30` | Participant admin rights revoked. | `[Demoted Participant JID(s)...]` |
| **`CHANGE_EPHEMERAL_SETTING`**| `72` | Ephemeral (disappearing) messages toggled. | `[Timer duration in seconds (e.g. '86400'), Actor JID]` |
| **`INDIVIDUAL_CHANGE_NUMBER`**| `42` | A contact changed their phone number. | `[New Phone Number JID]` |

---

## 2. Backend Ingestion Strategy

Since stub messages don't have a normal text body, the best approach is to categorize them under a `'system'` message type in your database and serialize their parameters into the message's `content` JSON column.

### Step A: Update Database Types/Mapping

When parsing messages in `MessageService.ts`, check if a message has a stub type:

```typescript
import { WAMessageStubType } from '@whiskeysockets/baileys'

// inside processMessage(msg: BaileysMessage) ...

let messageType = unwrapped ? getMessageType(unwrapped) : 'unknown'
let textContent: string | null = null
let rawMessage = msg.message ? JSON.parse(JSON.stringify(msg.message)) : null

// Identify if this is a system stub message
const isStub = msg.messageStubType !== undefined && msg.messageStubType !== null

if (isStub && msg.messageStubType !== WAMessageStubType.REVOKE && msg.messageStubType !== WAMessageStubType.CIPHERTEXT) {
  // Store it as a system message
  messageType = 'system'
  
  // Package the stub information inside the content object
  rawMessage = {
    stubType: typeof msg.messageStubType === 'number' 
      ? WAMessageStubType[msg.messageStubType] // Convert enum ID to string name
      : msg.messageStubType,
    parameters: msg.messageStubParameters || []
  }
}
```

This will save the message in your database with `messageType: 'system'` and a payload like this in the `content` JSON field:
```json
{
  "stubType": "GROUP_PARTICIPANT_ADD",
  "parameters": ["123456789@s.whatsapp.net"]
}
```

---

## 3. Frontend Rendering Strategy (React Example)

In your React UI, when rendering the message history list, check if the message type is `'system'`. Instead of rendering a speech bubble, render a centered system label.

### Step B: Create a System Message Translator

Create a helper function to resolve raw JIDs into contact names (using your local contact cache) and output human-readable sentences:

```typescript
interface SystemContent {
  stubType: string
  parameters: string[]
}

export function renderSystemMessage(contentJson: string, resolver: (jid: string) => string): string {
  try {
    const data: SystemContent = JSON.parse(contentJson)
    const params = data.parameters || []
    
    // Resolve helper
    const getName = (jid: string) => resolver(jid) || jid.split('@')[0]

    switch (data.stubType) {
      case 'CALL_MISSED_VOICE':
        return 'Missed voice call'
      case 'CALL_MISSED_VIDEO':
        return 'Missed video call'
      case 'GROUP_CREATE':
        return `${getName(params[0])} created this group`
      case 'GROUP_CHANGE_SUBJECT':
        return `${getName(params[1])} changed the group name to "${params[0]}"`
      case 'GROUP_PARTICIPANT_ADD':
        return `${getName(params[0])} was added to the group`
      case 'GROUP_PARTICIPANT_REMOVE':
        return `${getName(params[0])} was removed from the group`
      case 'GROUP_PARTICIPANT_LEAVE':
        return `${getName(params[0])} left the group`
      case 'GROUP_PARTICIPANT_PROMOTE':
        return `${getName(params[0])} is now an admin`
      case 'GROUP_PARTICIPANT_DEMOTE':
        return `${getName(params[0])} is no longer an admin`
      case 'CHANGE_EPHEMERAL_SETTING':
        const timer = parseInt(params[0], 10)
        if (timer === 0) {
          return `${getName(params[1])} turned off disappearing messages`
        }
        const days = Math.round(timer / 86400)
        return `${getName(params[1])} set messages to disappear after ${days} days`
      default:
        // Fallback for unhandled stubs
        return `System notice: ${data.stubType}`
    }
  } catch {
    return 'System notification'
  }
}
```

### Step C: UI Component Render

In your Chat view container:

```tsx
import React from 'react'

export const SystemMessageBubble = ({ message, resolveContactName }) => {
  const text = renderSystemMessage(message.content, resolveContactName)
  
  return (
    <div className="flex justify-center my-2">
      <div className="bg-gray-200 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 text-xs px-3 py-1.5 rounded-md shadow-sm max-w-md text-center">
        {text}
      </div>
    </div>
  )
}
```
