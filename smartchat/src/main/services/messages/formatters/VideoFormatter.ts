import { MessageFormatter, MessageFormattingContext, FormatterMessageInput } from './MessageFormatter';

interface VideoContent {
  videoMessage?: {
    caption?: string | null;
    [key: string]: unknown;
  } | null;
  ptvMessage?: {
    caption?: string | null;
    [key: string]: unknown;
  } | null;
}

export class VideoFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'videoMessage' || messageType === 'ptvMessage';
  }

  format(
    unwrappedContent: Record<string, any> | null | undefined,
    message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string {
    const vidContent = unwrappedContent as VideoContent | null | undefined;
    const vid = vidContent?.videoMessage || vidContent?.ptvMessage;
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
