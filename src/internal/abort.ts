export type Unsubscribe = () => void;

export const noop: Unsubscribe = () => {};

export function onAbort(signal: AbortSignal | undefined, listener: (reason: unknown) => void): Unsubscribe {
  if (signal === undefined) return noop;
  let active = true;
  const handler = (): void => {
    if (!active) return;
    active = false;
    signal.removeEventListener('abort', handler);
    listener(signal.reason);
  };
  signal.addEventListener('abort', handler);
  return () => {
    if (!active) return;
    active = false;
    signal.removeEventListener('abort', handler);
  };
}

export function timeoutReason(message: string): unknown {
  if (typeof DOMException === 'function') return new DOMException(message, 'TimeoutError');
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}
