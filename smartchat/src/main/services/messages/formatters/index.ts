import { MessageFormatterRegistry } from './MessageFormatterRegistry'
import { ConversationFormatter } from './ConversationFormatter'
import { ImageFormatter } from './ImageFormatter'
import { VideoFormatter } from './VideoFormatter'
import { StickerFormatter } from './StickerFormatter'
import { DocumentFormatter } from './DocumentFormatter'
import { AudioFormatter } from './AudioFormatter'
import { ContactFormatter } from './ContactFormatter'
import { LocationFormatter } from './LocationFormatter'
import { PollFormatter } from './PollFormatter'
import { ReactionFormatter } from './ReactionFormatter'

export type { MessageFormatter, MessageFormattingContext, FormatterMessageInput } from './MessageFormatter'
export { MessageFormatterRegistry } from './MessageFormatterRegistry'

/**
 * Factory function that instantiates the MessageFormatterRegistry
 * and registers all available concrete message formatters.
 */
export function createMessageFormatterRegistry(): MessageFormatterRegistry {
  const registry = new MessageFormatterRegistry()
  registry.registerFormatter(new ConversationFormatter())
  registry.registerFormatter(new ImageFormatter())
  registry.registerFormatter(new VideoFormatter())
  registry.registerFormatter(new StickerFormatter())
  registry.registerFormatter(new DocumentFormatter())
  registry.registerFormatter(new AudioFormatter())
  registry.registerFormatter(new ContactFormatter())
  registry.registerFormatter(new LocationFormatter())
  registry.registerFormatter(new PollFormatter())
  registry.registerFormatter(new ReactionFormatter())
  return registry
}
