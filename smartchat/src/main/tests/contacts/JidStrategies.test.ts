import { describe, it, expect } from 'vitest'
import {
  PnJidStrategy,
  LidJidStrategy,
  GroupJidStrategy,
  BotJidStrategy
} from '../../services/contacts/JidStrategies'

describe('JidStrategies', () => {
  describe('PnJidStrategy', () => {
    const strategy = new PnJidStrategy()
    
    it('should support PN jids', () => {
      expect(strategy.supports('1234567890@s.whatsapp.net')).toBe(true)
    })
    
    it('should not support other jids', () => {
      expect(strategy.supports('1234567890@lid')).toBe(false)
      expect(strategy.supports('1234567890@g.us')).toBe(false)
      expect(strategy.supports('1234567890@bot')).toBe(false)
      expect(strategy.supports('1234567890')).toBe(false)
    })
    
    it('should have aliasType PN', () => {
      expect(strategy.aliasType).toBe('PN')
    })
  })

  describe('LidJidStrategy', () => {
    const strategy = new LidJidStrategy()
    
    it('should support LID jids', () => {
      expect(strategy.supports('1234567890@lid')).toBe(true)
    })
    
    it('should not support other jids', () => {
      expect(strategy.supports('1234567890@s.whatsapp.net')).toBe(false)
      expect(strategy.supports('1234567890@g.us')).toBe(false)
      expect(strategy.supports('1234567890@bot')).toBe(false)
    })
    
    it('should have aliasType LID', () => {
      expect(strategy.aliasType).toBe('LID')
    })
  })

  describe('GroupJidStrategy', () => {
    const strategy = new GroupJidStrategy()
    
    it('should support Group jids', () => {
      expect(strategy.supports('1234567890@g.us')).toBe(true)
    })
    
    it('should not support other jids', () => {
      expect(strategy.supports('1234567890@s.whatsapp.net')).toBe(false)
      expect(strategy.supports('1234567890@lid')).toBe(false)
      expect(strategy.supports('1234567890@bot')).toBe(false)
    })
    
    it('should have aliasType GROUP', () => {
      expect(strategy.aliasType).toBe('GROUP')
    })
  })

  describe('BotJidStrategy', () => {
    const strategy = new BotJidStrategy()
    
    it('should support Bot jids', () => {
      expect(strategy.supports('1234567890@bot')).toBe(true)
    })
    
    it('should not support other jids', () => {
      expect(strategy.supports('1234567890@s.whatsapp.net')).toBe(false)
      expect(strategy.supports('1234567890@lid')).toBe(false)
      expect(strategy.supports('1234567890@g.us')).toBe(false)
    })
    
    it('should have aliasType BOT', () => {
      expect(strategy.aliasType).toBe('BOT')
    })
  })
})
