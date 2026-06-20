import { MessageFormatter, MessageFormattingContext, FormatterMessageInput, IFormattedMessageContent } from './MessageFormatter';

export class ConversationFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'conversation' || messageType === 'extendedTextMessage';
  }

  format(
    unwrappedContent: IFormattedMessageContent | null | undefined,
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
