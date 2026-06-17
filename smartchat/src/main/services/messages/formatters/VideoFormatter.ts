import { proto } from '@whiskeysockets/baileys';
import { MessageFormatter, MessageFormattingContext, FormatterMessageInput } from './MessageFormatter';

export class VideoFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'videoMessage' || messageType === 'ptvMessage';
  }

  format(
    unwrappedContent: proto.IMessage | null | undefined,
    message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string {
    const vid = unwrappedContent?.videoMessage || unwrappedContent?.ptvMessage;
    const caption = vid?.caption || message.textContent || '';

    switch (context) {
      case 'transcript':
        return caption ? `[Video] "${caption}"` : '[Video]';
      case 'notification':
        return caption ? `📹 ${caption}` : '📹 Video';
      case 'chatList':
        return 'Video';
      case 'chatListReaction':
        return caption || 'Video';
      default:
        return caption || 'Video';
    }
  }
}
