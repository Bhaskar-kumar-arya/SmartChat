import { proto } from '@whiskeysockets/baileys';
import { MessageFormatter, MessageFormattingContext, FormatterMessageInput } from './MessageFormatter';

export class ConversationFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'conversation' || messageType === 'extendedTextMessage';
  }

  format(
    unwrappedContent: proto.IMessage | null | undefined,
    message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string {
    const text = message.textContent || '';
    if (context === 'transcript' && message.messageType === 'extendedTextMessage' && unwrappedContent) {
      const extText = unwrappedContent.extendedTextMessage;
      const extTextWithUrl = extText as { canonicalUrl?: string | null } | null | undefined;
      const canonicalUrl = extTextWithUrl?.canonicalUrl;
      if (canonicalUrl) {
        return `${text} [Link: ${canonicalUrl}]`;
      }
    }
    return text;
  }
}
