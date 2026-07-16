import { AIMention } from '../IAIService'

export interface IAIMentionEnricher {
  enrichMentionsInline(prompt: string, mentions: AIMention[]): Promise<string>
}
