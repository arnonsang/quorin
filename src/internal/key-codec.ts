import { createBudget } from './budget.ts';
import { writeCanonicalJson, type JsonValue } from './json.ts';

export function encodeKey(key: unknown): string {
  return writeCanonicalJson(key, createBudget(undefined));
}

export function decodeKey<K extends JsonValue>(encoded: string): K {
  return JSON.parse(encoded) as K;
}
