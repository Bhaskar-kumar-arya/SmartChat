import { MessageFormatter, MessageFormattingContext, FormatterMessageInput } from './MessageFormatter';

interface PollContent {
  pollCreationMessage?: {
    name?: string | null;
    options?: Array<{ optionName?: string | null; [key: string]: unknown }> | null;
    [key: string]: unknown;
  } | null;
}

export class PollFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'pollCreationMessage' || messageType === 'pollUpdateMessage';
  }

  format(
    unwrappedContent: Record<string, any> | null | undefined,
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

    const pollContent = unwrappedContent as PollContent | null | undefined;
    const poll = pollContent?.pollCreationMessage;
    const pollName = poll?.name || message.textContent || '';
    const options = poll?.options ? poll.options.map(o => o.optionName || '').join(', ') : '';

    switch (context) {
      case 'transcript':
        if (poll || pollContent?.pollCreationMessage !== undefined) {
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
