import { traversalLimit } from './errors.ts';
import { assertInteger } from './validate.ts';

export interface TraversalOptions {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}

export const DEFAULT_MAX_DEPTH = 128;
export const DEFAULT_MAX_NODES = 100_000;

export interface Budget {
  readonly maxDepth: number;
  readonly maxNodes: number;
  nodes: number;
}

export function createBudget(options: TraversalOptions | undefined): Budget {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = options?.maxNodes ?? DEFAULT_MAX_NODES;
  assertInteger('maxDepth', maxDepth, 1);
  assertInteger('maxNodes', maxNodes, 1);
  return { maxDepth, maxNodes, nodes: 0 };
}

export function enter(budget: Budget, depth: number): void {
  if (depth > budget.maxDepth) throw traversalLimit(`Traversal exceeded maxDepth ${budget.maxDepth}`);
  if (budget.nodes >= budget.maxNodes) throw traversalLimit(`Traversal exceeded maxNodes ${budget.maxNodes}`);
  budget.nodes++;
}
