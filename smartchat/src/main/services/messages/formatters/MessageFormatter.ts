export type MessageFormattingContext = 'transcript' | 'notification' | 'chatList' | 'chatListReaction';

export interface FormatterMessageInput {
  textContent?: string | null;
  messageType: string;
  isDeleted?: boolean;
}

export interface MessageFormatter {
  /**
   * Determines if this formatter supports the given message type.
   */
  supports(messageType: string): boolean;

  /**
   * Formats a message into a plain string according to the requested context.
   * 
   * @param unwrappedContent - The unwrapped content object containing message details.
   * @param message - Basic message properties from the database or payload.
   * @param context - The context in which the message is being formatted.
   */
  format(
    unwrappedContent: Record<string, any> | null | undefined,
    message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string;
}


