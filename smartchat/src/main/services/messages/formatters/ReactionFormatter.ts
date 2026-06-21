import { MessageFormatter, MessageFormattingContext, FormatterMessageInput } from './MessageFormatter';

interface ReactionContent {
  reactionMessage?: {
    text?: string | null;
    [key: string]: unknown;
  } | null;
}

export class ReactionFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'reactionMessage';
  }

  format(
    unwrappedContent: Record<string, any> | null | undefined,
    message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string {
    const text = (unwrappedContent as ReactionContent | null | undefined)?.reactionMessage?.text || message.textContent || '';
    
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
