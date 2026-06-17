import { proto } from '@whiskeysockets/baileys';
import { MessageFormatter, MessageFormattingContext, FormatterMessageInput } from './MessageFormatter';

export class ContactFormatter implements MessageFormatter {
  supports(messageType: string): boolean {
    return messageType === 'contactMessage' || messageType === 'contactsArrayMessage';
  }

  format(
    unwrappedContent: proto.IMessage | null | undefined,
    message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string {
    if (message.messageType === 'contactsArrayMessage') {
      switch (context) {
        case 'transcript':
          return '[Multiple Contacts]';
        case 'notification':
          return '👤 Contact info';
        case 'chatList':
        case 'chatListReaction':
        default:
          return 'Multiple Contacts';
      }
    }

    const card = unwrappedContent?.contactMessage;
    const displayName = card?.displayName;

    switch (context) {
      case 'transcript':
        return displayName ? `[Contact Card: ${displayName}]` : '[Contact Card]';
      case 'notification':
        return '👤 Contact info';
      case 'chatList':
      case 'chatListReaction':
      default:
        return displayName ? `Contact Card: ${displayName}` : 'Contact Card';
    }
  }
}
