import { invalidArgument, invalidRange } from './errors.ts';

export function assertFunction(name: string, value: unknown): void {
  if (typeof value !== 'function') throw invalidArgument(`${name} must be a function`);
}

export function assertInteger(name: string, value: unknown, min: number, max: number = Number.MAX_SAFE_INTEGER): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw invalidArgument(`${name} must be a safe integer`);
  }
  if (value < min || value > max) throw invalidRange(`${name} must be between ${min} and ${max}`);
}

export function assertDuration(name: string, value: unknown, allowInfinity = false): void {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw invalidArgument(`${name} must be a number of milliseconds`);
  }
  if (value === Infinity && allowInfinity) return;
  if (!Number.isFinite(value) || value < 0) {
    throw invalidRange(`${name} must be a finite nonnegative number of milliseconds`);
  }
}

export function assertOptionalSignal(name: string, value: unknown): asserts value is AbortSignal | undefined {
  if (value === undefined) return;
  const candidate = value as Partial<AbortSignal> | null;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.aborted !== 'boolean' ||
    typeof candidate.addEventListener !== 'function' ||
    typeof candidate.removeEventListener !== 'function'
  ) {
    throw invalidArgument(`${name} must be an AbortSignal`);
  }
}

export function assertOptionsObject(name: string, value: unknown): void {
  if (value !== undefined && (typeof value !== 'object' || value === null)) {
    throw invalidArgument(`${name} must be an object`);
  }
}
