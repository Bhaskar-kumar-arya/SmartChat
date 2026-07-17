import { describe, it, expect } from 'vitest'
import { CitationEmitter } from '../../../../services/ai/citations/CitationEmitter'
import { CitationEntity } from '../../../../services/ai/citations/ICitationEmitter'

describe('CitationEmitter', () => {
  it('should initialize with the given start offset', () => {
    const emitter = new CitationEmitter(5)
    expect(emitter.getEntries().size).toBe(0)
  })

  it('should increment index for each registered entity', () => {
    const emitter = new CitationEmitter(0)
    
    const entity1: CitationEntity = { type: 'chat', chatJid: '123@s.whatsapp.net' }
    const entity2: CitationEntity = { type: 'message', chatJid: '123@s.whatsapp.net', messageId: 'msg1' }

    const index1 = emitter.register(entity1)
    const index2 = emitter.register(entity2)

    expect(index1).toBe(1)
    expect(index2).toBe(2)

    const entries = emitter.getEntries()
    expect(entries.size).toBe(2)
    expect(entries.get(1)).toEqual(entity1)
    expect(entries.get(2)).toEqual(entity2)
  })

  it('should continue from the provided offset', () => {
    const emitter = new CitationEmitter(10)
    
    const entity: CitationEntity = { type: 'file', filePath: '/path/to/file.txt' }
    const index = emitter.register(entity)

    expect(index).toBe(11)
    const entries = emitter.getEntries()
    expect(entries.get(11)).toEqual(entity)
  })
})
