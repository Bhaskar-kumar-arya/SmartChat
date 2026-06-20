import { MessageFormatter, MessageFormattingContext, FormatterMessageInput, IFormattedMessageContent } from './MessageFormatter';

export class StickerFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'stickerMessage' || messageType === 'lottieStickerMessage';
  }

  format(
    _unwrappedContent: IFormattedMessageContent | null | undefined,
    _message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string {
    switch (context) {
      case 'transcript':
        return '[Sticker]';
      case 'notification':
        return '👾 Sticker';
      case 'chatList':
      case 'chatListReaction':
      default:
        return 'Sticker';
    }
  }
}
