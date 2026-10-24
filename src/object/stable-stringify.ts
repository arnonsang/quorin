import { createBudget, type TraversalOptions } from '../internal/budget.ts';
import { writeCanonicalJson, type JsonValue } from '../internal/json.ts';

/**
 * Serializes a JSON value with record keys sorted by UTF-16 code unit order.
 * Values outside the JSON domain throw `UNSUPPORTED_VALUE`.
 */
export function stableStringify(value: JsonValue, options?: TraversalOptions): string {
  return writeCanonicalJson(value, createBudget(options));
}
