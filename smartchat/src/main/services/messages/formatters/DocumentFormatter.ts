import { MessageFormatter, MessageFormattingContext, FormatterMessageInput, IFormattedMessageContent } from './MessageFormatter';

export class DocumentFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'documentMessage' || messageType === 'documentWithCaptionMessage';
  }

  format(
    unwrappedContent: IFormattedMessageContent | null | undefined,
    message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string {
    const doc = unwrappedContent?.documentMessage || unwrappedContent?.documentWithCaptionMessage?.message?.documentMessage;
    const fileName = doc?.fileName || 'unnamed';
    const caption = doc?.caption || message.textContent || '';

    switch (context) {
      case 'transcript':
        if (doc || unwrappedContent?.documentMessage !== undefined) {
          return caption ? `[File: ${fileName}] "${caption}"` : `[File: ${fileName}]`;
        }
        return '[File]';
      case 'notification':
        return caption ? `📄 ${caption}` : '📄 Document';
      case 'chatList':
        return 'Document';
      case 'chatListReaction':
        return caption || 'Document';
      default:
        return caption || 'Document';
    }
  }
}
