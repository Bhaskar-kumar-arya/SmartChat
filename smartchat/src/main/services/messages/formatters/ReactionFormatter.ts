import { MessageFormatter, MessageFormattingContext, FormatterMessageInput, IFormattedMessageContent } from './MessageFormatter';

export class ReactionFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'reactionMessage';
  }

  format(
    unwrappedContent: IFormattedMessageContent | null | undefined,
    message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string {
    const text = unwrappedContent?.reactionMessage?.text || message.textContent || '';
    
    switch (context) {
      case 'transcript':
        return `[Reaction: ${text}]`;
      case 'notification':
        return text ? `Reacted ${text}` : 'Reaction';
      case 'chatList':
      case 'chatListReaction':
      default:
        return text ? `Reaction: ${text}` : 'Reaction';
    }
  }
}
