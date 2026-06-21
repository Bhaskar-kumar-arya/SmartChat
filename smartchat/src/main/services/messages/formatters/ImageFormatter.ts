import { MessageFormatter, MessageFormattingContext, FormatterMessageInput } from './MessageFormatter';

interface ImageContent {
  imageMessage?: {
    caption?: string | null;
    [key: string]: unknown;
  } | null;
}

export class ImageFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'imageMessage';
  }

  format(
    unwrappedContent: Record<string, any> | null | undefined,
    message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string {
    const caption = (unwrappedContent as ImageContent | null | undefined)?.imageMessage?.caption || message.textContent || '';
    
    switch (context) {
      case 'transcript':
        return caption ? `[Photo] "${caption}"` : '[Photo]';
      case 'notification':
        return caption ? `📷 ${caption}` : '📷 Photo';
      case 'chatList':
        return 'Photo';
      case 'chatListReaction':
        return caption || 'Photo';
      default:
        return caption || 'Photo';
    }
  }
}
