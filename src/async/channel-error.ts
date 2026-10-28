export type ChannelErrorCode = 'CHANNEL_CLOSED';

/** Rejection reason for operations on a closed channel. */
export class ChannelError extends Error {
  override name = 'ChannelError';
  readonly code: ChannelErrorCode;

  constructor(code: ChannelErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
