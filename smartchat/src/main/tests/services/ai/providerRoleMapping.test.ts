import { describe, it, expect } from 'vitest'
import {
  openAICompatProviders,
  installFakeOpenAIStream,
  sentMessages,
  makeGemini,
  type GeminiContent
} from './providerTestUtils'

/**
 * S6-02: app history uses role 'ai' for assistant turns. Groq/Mistral/DeepSeek
 * previously only recognised 'model'/'assistant', so every prior assistant turn
 * was sent to the model as a `user` message, destroying multi-turn structure.
 *
 * N-09: run through the shared util for every provider, incl. Gemini (B-AI-04).
 */
const history = [
  { role: 'user', content: 'hi' },
  { role: 'ai', content: 'hello there' }
]

describe('provider history role mapping (S6-02)', () => {
  for (const { name, make } of openAICompatProviders) {
    describe(name, () => {
      it('maps role "ai" to assistant', () => {
        const msgs = make().formatMessages('next', history, '')
        expect(msgs.find(m => m.content === 'hello there')?.role).toBe('assistant')
      })

      it.each(['model', 'assistant'])('maps role "%s" to assistant', role => {
        const msgs = make().formatMessages('next', [{ role, content: 'x' }], '')
        expect(msgs[0].role).toBe('assistant')
      })

      it('maps user and unknown roles to user', () => {
        const msgs = make().formatMessages(
          'next',
          [
            { role: 'user', content: 'a' },
            { role: 'weird', content: 'b' }
          ],
          ''
        )
        expect(msgs.map(m => m.role)).toEqual(['user', 'user', 'user'])
      })

      it('prepends the system prompt and appends the prompt as the final user turn', () => {
        const msgs = make().formatMessages('next', history, 'SYS')
        expect(msgs).toEqual([
          { role: 'system', content: 'SYS' },
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello there' },
          { role: 'user', content: 'next' }
        ])
      })

      it('omits the system message when systemPrompt is empty', () => {
        const msgs = make().formatMessages('next', [], '')
        expect(msgs).toEqual([{ role: 'user', content: 'next' }])
      })

      it('sends the mapped messages through the streaming request', async () => {
        const p = make()
        const { create } = installFakeOpenAIStream(p, [])
        await p.generateResponseStream('next', history, { model: 'x:m', systemPrompt: 'SYS' }, () => undefined)
        expect(sentMessages(create).map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
      })
    })
  }
})

describe('GeminiProvider history role mapping', () => {
  async function contentsFor(hist: Array<{ role: string; content: string; isSystem?: boolean }>, stream = true) {
    const g = makeGemini()
    if (stream) {
      await g.provider.generateResponseStream('next', hist, { model: 'gemini:m' }, () => undefined)
      return g.generateContentStream.mock.calls[0][0].contents as GeminiContent[]
    }
    await g.provider.generateResponse('next', hist, { model: 'gemini:m' })
    return g.generateContent.mock.calls[0][0].contents as GeminiContent[]
  }

  it.each([true, false])('maps user to user and ai/model/assistant to model (stream=%s)', async stream => {
    const contents = await contentsFor(
      [
        { role: 'user', content: 'hi' },
        { role: 'ai', content: 'a' },
        { role: 'model', content: 'b' },
        { role: 'assistant', content: 'c' }
      ],
      stream
    )
    expect(contents.map(c => c.role)).toEqual(['user', 'model', 'model', 'model', 'user'])
  })

  it('labels turns [USER]/[AI]/[SYSTEM] and wraps the final prompt as the last user turn', async () => {
    const contents = await contentsFor([
      { role: 'user', content: 'hi' },
      { role: 'ai', content: 'yo' },
      { role: 'user', content: 'tool out', isSystem: true }
    ])
    expect(contents.map(c => c.parts[0].text)).toEqual([
      '[USER]: hi',
      '[AI]: yo',
      '[SYSTEM]: tool out',
      '[USER]: next'
    ])
    expect(contents.map(c => c.role)).toEqual(['user', 'model', 'user', 'user'])
  })

  it('tolerates empty/undefined history', async () => {
    const g = makeGemini()
    await g.provider.generateResponseStream('p', undefined as never, { model: 'gemini:m' }, () => undefined)
    expect(g.generateContentStream.mock.calls[0][0].contents).toEqual([{ role: 'user', parts: [{ text: '[USER]: p' }] }])
  })

  // B-AI-04 (F-AI-1 fixes): a history turn with a non-'user' role that is flagged
  // isSystem (e.g. a persisted `[SYSTEM] Tool Result` turn labelled 'system')
  // collapses into a Gemini `model` turn labelled [AI], mislabeling tool output
  // as the assistant's own words. Expected: stays a user turn labelled [SYSTEM].
  it.fails('B-AI-04: a system-flagged non-user turn is sent as a user [SYSTEM] turn, not model [AI]', async () => {
    const contents = await contentsFor([{ role: 'system', content: 'tool out', isSystem: true }])
    expect(contents[0].role).toBe('user')
    expect(contents[0].parts[0].text).toBe('[SYSTEM]: tool out')
  })
})
