export type QueueErrorCode = 'QUEUE_FULL' | 'QUEUE_CLEARED';

/** Rejection reason for a full or cleared limiter queue. */
export class QueueError extends Error {
  override name = 'QueueError';
  readonly code: QueueErrorCode;

  constructor(code: QueueErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
