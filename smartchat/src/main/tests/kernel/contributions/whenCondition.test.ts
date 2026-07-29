import { describe, it, expect } from 'vitest'
import { evaluateWhen } from '../../../../renderer/src/utils/whenCondition'
import type { ChatWhenContext, MessageWhenContext, WhenCondition } from '../../../kernel/contributions/WhenCondition'

describe('evaluateWhen', () => {
  const dummyChatContext: ChatWhenContext = {
    'chat.type': 'GROUP',
    'chat.unreadCount': 5,
    'chat.isPinned': true,
    'chat.isMuted': false,
    'chat.isAnnounce': false,
    'chat.isCommunity': false
  }

  const dummyMessageContext: MessageWhenContext = {
    'message.messageType': 'audioMessage',
    'message.fromMe': false,
    'message.isDeleted': false,
    'message.isEdited': false,
    'message.isMedia': true,
    'message.isText': false,
    'message.hasReactions': true
  }

  it('returns true when condition is undefined', () => {
    expect(evaluateWhen(undefined, dummyChatContext)).toBe(true)
  })

  it('evaluates leaf comparison op eq correctly', () => {
    const condition: WhenCondition = { field: 'chat.type', op: 'eq', value: 'GROUP' }
    expect(evaluateWhen(condition, dummyChatContext)).toBe(true)

    const falseCondition: WhenCondition = { field: 'chat.type', op: 'eq', value: 'DM' }
    expect(evaluateWhen(falseCondition, dummyChatContext)).toBe(false)
  })

  it('evaluates leaf comparison op neq correctly', () => {
    const condition: WhenCondition = { field: 'chat.type', op: 'neq', value: 'DM' }
    expect(evaluateWhen(condition, dummyChatContext)).toBe(true)
  })

  it('evaluates numerical comparisons (gt, gte, lt, lte)', () => {
    expect(evaluateWhen({ field: 'chat.unreadCount', op: 'gt', value: 0 }, dummyChatContext)).toBe(true)
    expect(evaluateWhen({ field: 'chat.unreadCount', op: 'gt', value: 10 }, dummyChatContext)).toBe(false)
    expect(evaluateWhen({ field: 'chat.unreadCount', op: 'gte', value: 5 }, dummyChatContext)).toBe(true)
    expect(evaluateWhen({ field: 'chat.unreadCount', op: 'lt', value: 10 }, dummyChatContext)).toBe(true)
    expect(evaluateWhen({ field: 'chat.unreadCount', op: 'lte', value: 5 }, dummyChatContext)).toBe(true)
  })

  it('evaluates array membership (in, nin)', () => {
    expect(evaluateWhen({ field: 'message.messageType', op: 'in', value: ['audioMessage', 'ptvMessage'] }, dummyMessageContext)).toBe(true)
    expect(evaluateWhen({ field: 'message.messageType', op: 'in', value: ['imageMessage'] }, dummyMessageContext)).toBe(false)
    expect(evaluateWhen({ field: 'message.messageType', op: 'nin', value: ['imageMessage'] }, dummyMessageContext)).toBe(true)
  })

  it('evaluates all (AND) combinator', () => {
    const condition: WhenCondition = {
      all: [
        { field: 'chat.type', op: 'eq', value: 'GROUP' },
        { field: 'chat.unreadCount', op: 'gt', value: 0 }
      ]
    }
    expect(evaluateWhen(condition, dummyChatContext)).toBe(true)

    const failingCondition: WhenCondition = {
      all: [
        { field: 'chat.type', op: 'eq', value: 'GROUP' },
        { field: 'chat.unreadCount', op: 'gt', value: 10 }
      ]
    }
    expect(evaluateWhen(failingCondition, dummyChatContext)).toBe(false)
  })

  it('evaluates any (OR) combinator', () => {
    const condition: WhenCondition = {
      any: [
        { field: 'chat.type', op: 'eq', value: 'DM' },
        { field: 'chat.unreadCount', op: 'gt', value: 0 }
      ]
    }
    expect(evaluateWhen(condition, dummyChatContext)).toBe(true)
  })

  it('evaluates not combinator', () => {
    const condition: WhenCondition = {
      not: { field: 'message.fromMe', op: 'eq', value: true }
    }
    expect(evaluateWhen(condition, dummyMessageContext)).toBe(true)
  })

  it('evaluates deeply nested tree combinator', () => {
    const condition: WhenCondition = {
      all: [
        {
          any: [
            { field: 'chat.type', op: 'eq', value: 'GROUP' },
            { field: 'chat.type', op: 'eq', value: 'COMMUNITY' }
          ]
        },
        { not: { field: 'chat.isMuted', op: 'eq', value: true } }
      ]
    }
    expect(evaluateWhen(condition, dummyChatContext)).toBe(true)
  })
})
