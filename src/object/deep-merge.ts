import { createBudget, enter, type Budget } from '../internal/budget.ts';
import { unsupportedValue } from '../internal/errors.ts';
import { assertJsonScalar, forEachJsonEntry, isPlainRecord, type JsonRecord, type JsonValue } from '../internal/json.ts';
import { assertSafeKey } from './security-error.ts';

type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7];
type Simplify<T> = { [K in keyof T]: T[K] } & {};
type IsRecord<T> = T extends readonly unknown[] ? false : T extends object ? true : false;

type MergeValue<L, R, D extends number> = [IsRecord<L>, IsRecord<R>] extends [true, true]
  ? DeepMerge<L, R, D>
  : R;

/** The result type of `deepMerge`, where right-hand values replace left-hand values. */
export type DeepMerge<L, R, D extends number = 8> = [D] extends [never]
  ? JsonRecord
  : string extends keyof L | keyof R
    ? JsonRecord
    : Simplify<{
        [K in keyof L | keyof R]: K extends keyof R
          ? K extends keyof L
            ? MergeValue<L[K], R[K], Prev[D]>
            : R[K]
          : K extends keyof L
            ? L[K]
            : never;
      }>;

function cloneJson(value: unknown, budget: Budget, depth: number, ancestors: Set<object>): unknown {
  if (typeof value !== 'object' || value === null) {
    assertJsonScalar(value);
    return Object.is(value, -0) ? 0 : value;
  }
  if (ancestors.has(value)) throw unsupportedValue('Cyclic values are not JSON values');
  enter(budget, depth);
  ancestors.add(value);
  let output: unknown;
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    forEachJsonEntry(value, (_key, child) => items.push(cloneJson(child, budget, depth + 1, ancestors)));
    output = items;
  } else {
    const record: Record<string, unknown> = {};
    forEachJsonEntry(
      value,
      (key, child) => {
        record[key] = cloneJson(child, budget, depth + 1, ancestors);
      },
      { onRecordKey: assertSafeKey },
    );
    output = record;
  }
  ancestors.delete(value);
  return output;
}

function merge(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...left };
  for (const key of Object.keys(right)) {
    const current = output[key];
    const next = right[key];
    output[key] = Object.hasOwn(output, key) && isPlainRecord(current) && isPlainRecord(next) ? merge(current, next) : next;
  }
  return output;
}

/**
 * Recursively merges two JSON records into a new graph without mutating either input.
 * Records merge; arrays and primitives from `right` replace those from `left`.
 */
export function deepMerge<const L extends JsonRecord, const R extends JsonRecord>(left: L, right: R): DeepMerge<L, R> {
  if (!isPlainRecord(left) || !isPlainRecord(right)) throw unsupportedValue('deepMerge expects two plain records');
  const budget = createBudget(undefined);
  const leftCopy = cloneJson(left, budget, 1, new Set()) as Record<string, unknown>;
  const rightCopy = cloneJson(right, budget, 1, new Set()) as Record<string, unknown>;
  return merge(leftCopy, rightCopy) as DeepMerge<L, R>;
}
