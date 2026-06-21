export type MessageFormattingContext = 'transcript' | 'notification' | 'chatList' | 'chatListReaction';

export interface FormatterMessageInput {
  textContent?: string | null;
  messageType: string;
  isDeleted?: boolean;
}

export interface IFormattedMessageContent {
  contactMessage?: {
    displayName?: string | null;
    [key: string]: unknown;
  } | null;
  pollCreationMessage?: {
    name?: string | null;
    options?: Array<{ optionName?: string | null; [key: string]: unknown }> | null;
    [key: string]: unknown;
  } | null;
  audioMessage?: {
    seconds?: number | null;
    [key: string]: unknown;
  } | null;
  imageMessage?: {
    caption?: string | null;
    [key: string]: unknown;
  } | null;
  reactionMessage?: {
    text?: string | null;
    [key: string]: unknown;
  } | null;
  documentMessage?: {
    fileName?: string | null;
    caption?: string | null;
    [key: string]: unknown;
  } | null;
  documentWithCaptionMessage?: {
    message?: {
      documentMessage?: {
        fileName?: string | null;
        caption?: string | null;
        [key: string]: unknown;
      } | null;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  } | null;
  videoMessage?: {
    caption?: string | null;
    [key: string]: unknown;
  } | null;
  ptvMessage?: {
    caption?: string | null;
    [key: string]: unknown;
  } | null;
  extendedTextMessage?: {
    canonicalUrl?: string | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
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
    unwrappedContent: IFormattedMessageContent | null | undefined,
    message: FormatterMessageInput,
    context: MessageFormattingContext
  ): string;
}

