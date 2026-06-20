import { MessageFormatter, MessageFormattingContext, FormatterMessageInput, IFormattedMessageContent } from './MessageFormatter';

export class LocationFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'locationMessage' || messageType === 'liveLocationMessage';
  }

  format(
    _unwrappedContent: IFormattedMessageContent | null | undefined,
    _message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string {
    switch (context) {
      case 'transcript':
        return '[Location]';
      case 'notification':
        return '📍 Location';
      case 'chatList':
      case 'chatListReaction':
      default:
        return 'Location';
    }
  }
}
