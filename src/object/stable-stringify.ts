import { createBudget, type TraversalOptions } from '../internal/budget.ts';
import { writeCanonicalJson, type JsonValue } from '../internal/json.ts';

export function stableStringify(value: JsonValue, options?: TraversalOptions): string {
  return writeCanonicalJson(value, createBudget(options));
}
