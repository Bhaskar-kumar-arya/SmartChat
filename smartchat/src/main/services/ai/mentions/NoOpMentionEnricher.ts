import { IAIMentionEnricher } from './IAIMentionEnricher'
import { AIMention } from '../IAIService'

export class NoOpMentionEnricher implements IAIMentionEnricher {
  async enrichMentionsInline(prompt: string, _mentions: AIMention[]): Promise<string> {
    return prompt
  }
}
