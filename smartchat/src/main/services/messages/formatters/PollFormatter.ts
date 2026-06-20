import { MessageFormatter, MessageFormattingContext, FormatterMessageInput, IFormattedMessageContent } from './MessageFormatter';

export class PollFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'pollCreationMessage' || messageType === 'pollUpdateMessage';
  }

  format(
    unwrappedContent: IFormattedMessageContent | null | undefined,
    message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string {
    if (message.messageType === 'pollUpdateMessage') {
      switch (context) {
        case 'transcript':
          return '[Poll Vote]';
        case 'notification':
          return '📊 Poll Vote';
        case 'chatList':
        case 'chatListReaction':
        default:
          return 'Poll Vote';
      }
    }

    const poll = unwrappedContent?.pollCreationMessage;
    const pollName = poll?.name || message.textContent || '';
    const options = poll?.options ? poll.options.map(o => o.optionName || '').join(', ') : '';

    switch (context) {
      case 'transcript':
        if (poll || unwrappedContent?.pollCreationMessage !== undefined) {
          return `[Poll: ${pollName}] Options: (${options})`;
        }
        return '[Poll]';
      case 'notification':
        return pollName ? `📊 Poll: ${pollName}` : '📊 Poll';
      case 'chatList':
      case 'chatListReaction':
      default:
        return pollName ? `Poll: ${pollName}` : 'Poll';
    }
  }
}
