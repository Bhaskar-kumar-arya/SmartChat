import { proto } from '@whiskeysockets/baileys';
import { MessageFormatter, MessageFormattingContext, FormatterMessageInput } from './MessageFormatter';

export class MessageFormatterRegistry {
  private readonly formatters: MessageFormatter[] = [];

  /**
   * Registers a new formatter strategy.
   */
  registerFormatter(formatter: MessageFormatter): void {
    this.formatters.push(formatter);
  }

  /**
   * Formats message content using the first supporting strategy or fallbacks.
   */
  format(
    unwrappedContent: proto.IMessage | null | undefined,
    message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string {
    if (message.isDeleted) {
      return context === 'transcript' ? '(Message deleted)' : 'Message deleted';
    }

    const formatter = this.formatters.find(f => f.supports(message.messageType));
    if (formatter) {
      try {
        return formatter.format(unwrappedContent, message, context);
      } catch (err) {
        console.error(`[MessageFormatterRegistry] Formatter failed for ${message.messageType}:`, err);
      }
    }

    // Default fallbacks matching original business logic
    const text = message.textContent;
    switch (context) {
      case 'transcript':
        return text || `[${message.messageType}]`;
      case 'notification':
        return text || 'New message';
      case 'chatList':
        return text || '';
      case 'chatListReaction':
        return text || 'message';
      default:
        return text || '';
    }
  }
}
