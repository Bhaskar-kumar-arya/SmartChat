import { proto } from '@whiskeysockets/baileys';
import { MessageFormatter, MessageFormattingContext, FormatterMessageInput } from './MessageFormatter';

export class ImageFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'imageMessage';
  }

  format(
    unwrappedContent: proto.IMessage | null | undefined,
    message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string {
    const caption = unwrappedContent?.imageMessage?.caption || message.textContent || '';
    
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
