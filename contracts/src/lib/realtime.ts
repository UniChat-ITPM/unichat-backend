/** Redis Pub/Sub channel: messaging-service publishes, realtime-service subscribes. */
export const REALTIME_REDIS_CHANNEL = 'unichat:realtime';

export type RealtimeEventType =
  | 'MESSAGE_CREATED'
  | 'MESSAGE_EDITED'
  | 'MESSAGE_DELETED'
  | 'MESSAGE_STATUS_UPDATED';

export interface RealtimeEnvelope {
  type: RealtimeEventType;
  payload: unknown;
}

export function conversationRoom(conversationId: string): string {
  return `conv:${conversationId}`;
}
