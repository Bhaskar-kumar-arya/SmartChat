import { MessageFormatter, MessageFormattingContext, FormatterMessageInput, IFormattedMessageContent } from './MessageFormatter';

export class AudioFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'audioMessage';
  }

  format(
    unwrappedContent: IFormattedMessageContent | null | undefined,
    _message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string {
    const audio = unwrappedContent?.audioMessage;
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
