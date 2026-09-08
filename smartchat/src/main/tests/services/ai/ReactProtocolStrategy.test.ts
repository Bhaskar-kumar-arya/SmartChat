import { describe, it, expect } from 'vitest'
import { ReactProtocolStrategy } from '../../../services/ai/prompts/ReactProtocolStrategy'
import { StandardProtocolStrategy } from '../../../services/ai/prompts/StandardProtocolStrategy'

/**
 * S6-05: the React protocol block dropped rule 1 ("only ONE tool call per
 * response"). The tool-call extractor is a non-global regex that only ever
 * takes the first <tool_call> block, so a model told nothing about the limit
 * can emit several and silently lose all but the first.
 */
describe('ReactProtocolStrategy (S6-05)', () => {
  it('tells the model to emit only one tool call per response', () => {
    const block = new ReactProtocolStrategy().getProtocolBlock()
    expect(block).toMatch(/ONE tool call per response/i)
    expect(block).toMatch(/^1\. /m)
  })

  it('keeps the same single-tool-call rule as the standard protocol', () => {
    const std = new StandardProtocolStrategy().getProtocolBlock()
    expect(std).toMatch(/ONE tool call per response/i)
  })
})
