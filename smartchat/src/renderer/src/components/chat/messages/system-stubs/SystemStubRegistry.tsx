import React from 'react'
import { MessageItem as IMessageItem } from '../../../../types/chatTypes'

export interface SystemMessageContent {
  stubType: string
  parameters?: Array<string | { jid: string; name: string }>
}

export interface EnrichedContact {
  jid: string
  name: string
}

export function isEnrichedContact(val: unknown): val is EnrichedContact {
  return typeof val === 'object' && val !== null && 'jid' in val && 'name' in val
}

export interface NameChipProps {
  jid: string
  name: string
  onSelectChat?: (jid: string, name: string) => void
}

export function NameChip({ jid, name, onSelectChat }: NameChipProps) {
  const isClickable = !!jid && !!onSelectChat
  return (
    <span
      className={`system-message-name-chip ${isClickable ? 'clickable' : ''}`}
      style={{
        cursor: isClickable ? 'pointer' : 'default',
        fontWeight: 600,
        textDecoration: isClickable ? 'underline' : 'none',
        color: isClickable ? 'var(--primary-color, #25D366)' : 'inherit',
        margin: '0 2px'
      }}
      onClick={() => {
        if (isClickable) {
          onSelectChat(jid, name)
        }
      }}
    >
      {name}
    </span>
  )
}

export function formatParticipants(
  parameters: Array<string | EnrichedContact> | undefined,
  onSelectChat?: (jid: string, name: string) => void
) {
  if (!parameters) return ''
  const contacts = parameters.filter(isEnrichedContact)
  if (contacts.length === 0) return ''
  if (contacts.length === 1) {
    return <NameChip jid={contacts[0].jid} name={contacts[0].name} onSelectChat={onSelectChat} />
  }
  return (
    <>
      {contacts.slice(0, -1).map((p, i) => (
        <React.Fragment key={p.jid || i}>
          <NameChip jid={p.jid} name={p.name} onSelectChat={onSelectChat} />
          {i === contacts.length - 2 ? '' : ', '}
        </React.Fragment>
      ))}
      {' and '}
      <NameChip jid={contacts[contacts.length - 1].jid} name={contacts[contacts.length - 1].name} onSelectChat={onSelectChat} />
    </>
  )
}

export const SYSTEM_STUB_REGISTRY: Record<
  string,
  (
    content: SystemMessageContent,
    onSelectChat: ((jid: string, name: string) => void) | undefined,
    msg: IMessageItem
  ) => React.ReactNode
> = {
  GROUP_CREATE: (content, onSelectChat) => {
    const creator = content.parameters?.[0]
    const actorChip = isEnrichedContact(creator) ? <NameChip jid={creator.jid} name={creator.name} onSelectChat={onSelectChat} /> : null
    return actorChip ? <>{actorChip} created this group</> : <>Group was created</>
  },
  GROUP_CHANGE_SUBJECT: (content, onSelectChat) => {
    const changer = content.parameters?.[1]
    const actorChip = isEnrichedContact(changer) ? <NameChip jid={changer.jid} name={changer.name} onSelectChat={onSelectChat} /> : null
    const subject = typeof content.parameters?.[0] === 'string' ? content.parameters[0] : 'the subject'
    return actorChip ? (
      <>{actorChip} changed the subject to "{subject}"</>
    ) : (
      <>The subject was changed to "{subject}"</>
    )
  },
  GROUP_CHANGE_ICON: (content, onSelectChat) => {
    const actor = content.parameters?.[0]
    const actorChip = isEnrichedContact(actor) ? <NameChip jid={actor.jid} name={actor.name} onSelectChat={onSelectChat} /> : null
    return actorChip ? <>{actorChip} changed the group icon</> : <>The group icon was changed</>
  },
  GROUP_CHANGE_DESCRIPTION: (content, onSelectChat) => {
    const actor = content.parameters?.[0]
    const actorChip = isEnrichedContact(actor) ? <NameChip jid={actor.jid} name={actor.name} onSelectChat={onSelectChat} /> : null
    return actorChip ? <>{actorChip} changed the group description</> : <>The group description was changed</>
  },
  GROUP_PARTICIPANT_ADD: (content, onSelectChat, msg) => {
    const adderJid = msg.participant
    const adderChip = adderJid ? <NameChip jid={adderJid} name={msg.participantName || adderJid.split('@')[0]} onSelectChat={onSelectChat} /> : null
    const partsChip = formatParticipants(content.parameters, onSelectChat)
    return adderChip ? (
      <>{adderChip} added {partsChip}</>
    ) : (
      <>{partsChip} joined the group</>
    )
  },
  GROUP_PARTICIPANT_REMOVE: (content, onSelectChat, msg) => {
    const removerJid = msg.participant
    const removerChip = removerJid ? <NameChip jid={removerJid} name={msg.participantName || removerJid.split('@')[0]} onSelectChat={onSelectChat} /> : null
    const partsChip = formatParticipants(content.parameters, onSelectChat)
    return removerChip ? (
      <>{removerChip} removed {partsChip}</>
    ) : (
      <>{partsChip} left the group</>
    )
  },
  GROUP_PARTICIPANT_LEAVE: (content, onSelectChat) => {
    const actor = content.parameters?.[0]
    const actorChip = isEnrichedContact(actor) ? <NameChip jid={actor.jid} name={actor.name} onSelectChat={onSelectChat} /> : null
    return actorChip ? <>{actorChip} left the group</> : <>A participant left</>
  },
  GROUP_PARTICIPANT_PROMOTE: (content, onSelectChat, msg) => {
    if (msg.fromMe && !msg.participant) {
      return <>You were promoted to admin</>
    }
    const promoterJid = msg.participant
    const promoterChip = promoterJid
      ? <NameChip jid={promoterJid} name={msg.participantName || promoterJid.split('@')[0]} onSelectChat={onSelectChat} />
      : null
    const partsChip = formatParticipants(content.parameters, onSelectChat)
    if (promoterChip) {
      return partsChip
        ? <>{promoterChip} promoted {partsChip} to admin</>
        : <>{promoterChip} was promoted to admin</>
    }
    return partsChip
      ? <>{partsChip} {msg.fromMe ? 'were' : 'was'} promoted to admin</>
      : <>A participant was promoted to admin</>
  },
  GROUP_PARTICIPANT_DEMOTE: (content, onSelectChat, msg) => {
    if (msg.fromMe && !msg.participant) {
      return <>You were removed as admin</>
    }
    const demoterJid = msg.participant
    const demoterChip = demoterJid
      ? <NameChip jid={demoterJid} name={msg.participantName || demoterJid.split('@')[0]} onSelectChat={onSelectChat} />
      : null
    const partsChip = formatParticipants(content.parameters, onSelectChat)
    if (demoterChip) {
      return partsChip
        ? <>{demoterChip} removed {partsChip} as admin</>
        : <>{demoterChip} was removed as admin</>
    }
    return partsChip
      ? <>{partsChip} {msg.fromMe ? 'were' : 'was'} removed as admin</>
      : <>A participant was removed as admin</>
  },
  CHANGE_EPHEMERAL_SETTING: (content, onSelectChat) => {
    const timerSeconds = parseInt(typeof content.parameters?.[0] === 'string' ? content.parameters[0] : '0', 10)
    const changer = content.parameters?.[1]
    const actorChip = isEnrichedContact(changer) ? <NameChip jid={changer.jid} name={changer.name} onSelectChat={onSelectChat} /> : null
    
    let durationText = ''
    if (timerSeconds === 86400) durationText = '24 hours'
    else if (timerSeconds === 604800) durationText = '7 days'
    else if (timerSeconds === 7776000) durationText = '90 days'
    else if (timerSeconds > 0) durationText = `${Math.round(timerSeconds / 3600)} hours`

    const durationPhrase = durationText ? `to ${durationText}` : 'off'
    return actorChip ? (
      <>{actorChip} turned disappearing messages {durationPhrase}</>
    ) : (
      <>Disappearing messages were turned {durationPhrase}</>
    )
  },
  CALL_MISSED_VOICE: (_content, onSelectChat, msg) => {
    const callerJid = msg.participant || msg.chatJid
    const callerChip = callerJid ? <NameChip jid={callerJid} name={msg.participantName || callerJid.split('@')[0]} onSelectChat={onSelectChat} /> : null
    return <>Missed voice call {callerChip ? <>from {callerChip}</> : ''}</>
  },
  CALL_MISSED_VIDEO: (_content, onSelectChat, msg) => {
    const callerJid = msg.participant || msg.chatJid
    const callerChip = callerJid ? <NameChip jid={callerJid} name={msg.participantName || callerJid.split('@')[0]} onSelectChat={onSelectChat} /> : null
    return <>Missed video call {callerChip ? <>from {callerChip}</> : ''}</>
  },
  CALL_MISSED_GROUP_VOICE: (_content, onSelectChat, msg) => {
    const callerJid = msg.participant || msg.chatJid
    const callerChip = callerJid ? <NameChip jid={callerJid} name={msg.participantName || callerJid.split('@')[0]} onSelectChat={onSelectChat} /> : null
    return <>Missed group voice call {callerChip ? <>from {callerChip}</> : ''}</>
  },
  CALL_MISSED_GROUP_VIDEO: (_content, onSelectChat, msg) => {
    const callerJid = msg.participant || msg.chatJid
    const callerChip = callerJid ? <NameChip jid={callerJid} name={msg.participantName || callerJid.split('@')[0]} onSelectChat={onSelectChat} /> : null
    return <>Missed group video call {callerChip ? <>from {callerChip}</> : ''}</>
  },
  INDIVIDUAL_CHANGE_NUMBER: (content, onSelectChat) => {
    const actor = content.parameters?.[0]
    const actorChip = isEnrichedContact(actor) ? <NameChip jid={actor.jid} name={actor.name} onSelectChat={onSelectChat} /> : null
    return actorChip ? <>{actorChip} changed their phone number</> : <>A contact changed their phone number</>
  },
  GROUP_PARTICIPANT_INVITE: (content, onSelectChat) => {
    const partsChip = formatParticipants(content.parameters, onSelectChat)
    return partsChip ? <>{partsChip} joined via invite link</> : <>Someone joined via invite link</>
  },
  GROUP_PARTICIPANT_ACCEPT: (content, onSelectChat) => {
    const partsChip = formatParticipants(content.parameters, onSelectChat)
    return partsChip ? <>{partsChip} joined the group</> : <>Someone joined the group</>
  },
  GROUP_PARTICIPANT_ADD_REQUEST_JOIN: (content, onSelectChat) => {
    const partsChip = formatParticipants(content.parameters, onSelectChat)
    return partsChip ? <>{partsChip} requested to join</> : <>Someone requested to join</>
  },
  GROUP_PARTICIPANT_CHANGE_NUMBER: (content, onSelectChat) => {
    const partsChip = formatParticipants(content.parameters, onSelectChat)
    return partsChip ? <>{partsChip} changed their phone number</> : <>A member changed their phone number</>
  },
  GROUP_CHANGE_RESTRICT: (content, onSelectChat) => {
    const actor = content.parameters?.[0]
    const actorChip = isEnrichedContact(actor) ? <NameChip jid={actor.jid} name={actor.name} onSelectChat={onSelectChat} /> : null
    const mode = typeof content.parameters?.[1] === 'string' ? content.parameters[1] : ''
    const state = mode === 'on' ? 'only admins can send messages' : 'all members can send messages'
    return actorChip ? <>{actorChip} changed the group so {state}</> : <>Group: {state}</>
  },
  GROUP_CHANGE_ANNOUNCE: (content, onSelectChat) => {
    const actor = content.parameters?.[0]
    const actorChip = isEnrichedContact(actor) ? <NameChip jid={actor.jid} name={actor.name} onSelectChat={onSelectChat} /> : null
    const mode = typeof content.parameters?.[1] === 'string' ? content.parameters[1] : ''
    const state = mode === 'on' ? 'only admins can edit group info' : 'all members can edit group info'
    return actorChip ? <>{actorChip} changed the group so {state}</> : <>Group: {state}</>
  },
  GROUP_CHANGE_INVITE_LINK: (content, onSelectChat) => {
    const actor = content.parameters?.[0]
    const actorChip = isEnrichedContact(actor) ? <NameChip jid={actor.jid} name={actor.name} onSelectChat={onSelectChat} /> : null
    return actorChip ? <>{actorChip} reset the invite link</> : <>The invite link was reset</>
  },
  GROUP_DELETE: () => <>This group was deleted</>,
  ADMIN_REVOKE: (content, onSelectChat) => {
    const partsChip = formatParticipants(content.parameters, onSelectChat)
    return partsChip ? <>{partsChip} was removed by admin</> : <>A participant was removed by admin</>
  },
  E2E_ENCRYPTED: () => <>Messages are end-to-end encrypted.</>,
  E2E_ENCRYPTED_NOW: () => <>Messages are now end-to-end encrypted.</>,
  E2E_DEVICE_CHANGED: (content, onSelectChat) => {
    const actor = content.parameters?.[0]
    const actorChip = isEnrichedContact(actor) ? <NameChip jid={actor.jid} name={actor.name} onSelectChat={onSelectChat} /> : null
    return actorChip ? <>{actorChip}&apos;s security code changed</> : <>A security code changed</>
  },
  COMMUNITY_PARTICIPANT_PROMOTE: (content, onSelectChat) => {
    const partsChip = formatParticipants(content.parameters, onSelectChat)
    return partsChip ? <>{partsChip} was promoted to admin in this community</> : <>A member was promoted to admin</>
  },
  COMMUNITY_PARTICIPANT_DEMOTE: (content, onSelectChat) => {
    const partsChip = formatParticipants(content.parameters, onSelectChat)
    return partsChip ? <>{partsChip} was removed as admin in this community</> : <>A member was removed as admin</>
  },
  PINNED_MESSAGE_IN_CHAT: (content, onSelectChat) => {
    const actor = content.parameters?.[0]
    const actorChip = isEnrichedContact(actor) ? <NameChip jid={actor.jid} name={actor.name} onSelectChat={onSelectChat} /> : null
    return actorChip ? <>{actorChip} pinned a message</> : <>A message was pinned</>
  }
}
