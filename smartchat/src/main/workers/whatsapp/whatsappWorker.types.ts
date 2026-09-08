export interface WorkerInitPayload {
  dbPath: string;
  userDataPath: string;
  syncFullHistory: boolean;
  shouldSyncHistory: boolean;
}

export interface WorkerSendMessagePayload {
  jid: string;
  content: unknown;
  options?: unknown;
}

export interface WorkerReadMessagesPayload {
  keys: unknown[];
}

export interface WorkerChatModifyPayload {
  jid: string;
  modification: unknown;
}

export interface WorkerGetPnForLidPayload {
  lid: string;
}

export interface WorkerProfilePictureUrlPayload {
  jid: string;
  type: 'preview' | 'image';
}

export interface WorkerUpdateMediaMessagePayload {
  msg: unknown;
}

export interface WorkerFetchMessageHistoryPayload {
  /** How many older messages to request from WhatsApp. */
  count: number;
  /** Chat to page backwards in. */
  jid: string;
  /** Key of the oldest message currently stored locally for this chat. */
  oldestMsgId: string;
  oldestMsgFromMe: boolean;
  /** Timestamp of that oldest message, in milliseconds. */
  oldestMsgTimestampMs: number;
}

export type WorkerCommandMessage =
  | { type: 'init'; correlationId: string; payload: WorkerInitPayload }
  | { type: 'send_message'; correlationId: string; payload: WorkerSendMessagePayload }
  | { type: 'read_messages'; correlationId: string; payload: WorkerReadMessagesPayload }
  | { type: 'chat_modify'; correlationId: string; payload: WorkerChatModifyPayload }
  | { type: 'group_fetch_all'; correlationId: string; payload?: undefined }
  | { type: 'get_pn_for_lid'; correlationId: string; payload: WorkerGetPnForLidPayload }
  | { type: 'profile_picture_url'; correlationId: string; payload: WorkerProfilePictureUrlPayload }
  | { type: 'update_media_message'; correlationId: string; payload: WorkerUpdateMediaMessagePayload }
  | { type: 'group_metadata'; correlationId: string; payload: { jid: string } }
  | { type: 'logout'; correlationId: string; payload?: undefined }
  | { type: 'skip_sync'; correlationId: string; payload?: undefined }
  | { type: 'fetch_message_history'; correlationId: string; payload: WorkerFetchMessageHistoryPayload };

export type WorkerEventMessage =
  | { type: 'reply'; correlationId: string; payload: { result: unknown } }
  | { type: 'reply_error'; correlationId: string; error: string }
  | { type: 'domain_event'; payload: { event: string; data?: unknown } };
