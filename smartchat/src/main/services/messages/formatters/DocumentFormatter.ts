import { MessageFormatter, MessageFormattingContext, FormatterMessageInput } from './MessageFormatter';

interface DocumentContent {
  documentMessage?: {
    fileName?: string | null;
    caption?: string | null;
    [key: string]: unknown;
  } | null;
  documentWithCaptionMessage?: {
    message?: {
      documentMessage?: {
        fileName?: string | null;
        caption?: string | null;
        [key: string]: unknown;
      } | null;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  } | null;
}

export class DocumentFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'documentMessage' || messageType === 'documentWithCaptionMessage';
  }

  format(
    unwrappedContent: Record<string, any> | null | undefined,
    message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string {
    const docContent = unwrappedContent as DocumentContent | null | undefined;
    const doc = docContent?.documentMessage || docContent?.documentWithCaptionMessage?.message?.documentMessage;
    const fileName = doc?.fileName || 'unnamed';
    const caption = doc?.caption || message.textContent || '';

    switch (context) {
      case 'transcript':
        if (doc || docContent?.documentMessage !== undefined) {
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
