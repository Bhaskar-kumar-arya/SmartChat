import { MessageFormatter, MessageFormattingContext, FormatterMessageInput } from './MessageFormatter';

interface AudioContent {
  audioMessage?: {
    seconds?: number | null;
    [key: string]: unknown;
  } | null;
}

export class AudioFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'audioMessage';
  }

  format(
    unwrappedContent: Record<string, any> | null | undefined,
    _message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string {
    const audio = (unwrappedContent as AudioContent | null | undefined)?.audioMessage;
    const seconds = audio?.seconds ? `${audio.seconds}s` : '';

    switch (context) {
      case 'transcript':
        return seconds ? `[Audio: ${seconds}]` : '[Audio]';
      case 'notification':
        return '🎤 Voice message';
      case 'chatList':
      case 'chatListReaction':
      default:
        return 'Audio';
    }
  }
}
