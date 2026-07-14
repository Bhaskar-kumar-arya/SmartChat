import { describe, it, expect } from 'vitest'
import { ContactCache } from '../../services/contacts/ContactCache'

describe('ContactCache', () => {
  it('should handle identity id caching', () => {
    const cache = new ContactCache()
    expect(cache.getIdentityId('user@s.whatsapp.net')).toBeUndefined()
    expect(cache.hasIdentityId('user@s.whatsapp.net')).toBe(false)
    
    cache.setIdentityId('user@s.whatsapp.net', 10)
    
    expect(cache.hasIdentityId('user@s.whatsapp.net')).toBe(true)
    expect(cache.getIdentityId('user@s.whatsapp.net')).toBe(10)
  })

  it('should handle links caching', () => {
    const cache = new ContactCache()
    expect(cache.hasLink('user:lid')).toBe(false)
    
    cache.addLink('user:lid')
    
    expect(cache.hasLink('user:lid')).toBe(true)
  })

  it('should handle meJids caching', () => {
    const cache = new ContactCache()
    expect(cache.getMeJids()).toBeNull()
    
    cache.setMeJids(['me1@s.whatsapp.net', 'me2@lid'])
    
    expect(cache.getMeJids()).toEqual(['me1@s.whatsapp.net', 'me2@lid'])
  })

  it('should populate identity cache from map', () => {
    const cache = new ContactCache()
    const map = new Map<string, number>()
    map.set('user1@s.whatsapp.net', 1)
    map.set('user2@s.whatsapp.net', 2)
    
    cache.populateIdentityIdCache(map)
    
    expect(cache.getIdentityId('user1@s.whatsapp.net')).toBe(1)
    expect(cache.getIdentityId('user2@s.whatsapp.net')).toBe(2)
  })

  it('should clear all caches', () => {
    const cache = new ContactCache()
    cache.setIdentityId('user@s.whatsapp.net', 10)
    cache.addLink('link1')
    cache.setMeJids(['me'])
    
    cache.clear()
    
    expect(cache.hasIdentityId('user@s.whatsapp.net')).toBe(false)
    expect(cache.hasLink('link1')).toBe(false)
    expect(cache.getMeJids()).toBeNull()
  })
})
