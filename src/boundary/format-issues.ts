import { invalidArgument } from '../internal/errors.ts';
import { BoundaryValidationError } from './boundary-validation-error.ts';
import type { StandardSchemaV1 } from './standard-schema.ts';

export interface IssueGroup {
  readonly path: readonly PropertyKey[];
  readonly messages: readonly string[];
}

interface TrieNode {
  group: { path: PropertyKey[]; messages: string[] } | undefined;
  readonly children: Map<PropertyKey, TrieNode>;
}

/** Groups issue messages by typed path, in first-seen order. */
export function formatIssues(source: BoundaryValidationError | readonly StandardSchemaV1.Issue[]): readonly IssueGroup[] {
  const issues: readonly StandardSchemaV1.Issue[] = source instanceof BoundaryValidationError ? source.issues : source;
  if (!Array.isArray(source) && !(source instanceof BoundaryValidationError)) throw invalidArgument('formatIssues expects issues or a BoundaryValidationError');
  const root: TrieNode = { group: undefined, children: new Map() };
  const groups: { path: PropertyKey[]; messages: string[] }[] = [];
  for (const issue of issues) {
    const path = (issue.path ?? []).map((segment: PropertyKey | StandardSchemaV1.PathSegment) =>
      typeof segment === 'object' && segment !== null ? (segment as StandardSchemaV1.PathSegment).key : segment,
    );
    let node = root;
    for (const key of path) {
      let child = node.children.get(key);
      if (child === undefined) {
        child = { group: undefined, children: new Map() };
        node.children.set(key, child);
      }
      node = child;
    }
    if (node.group === undefined) {
      node.group = { path, messages: [] };
      groups.push(node.group);
    }
    node.group.messages.push(String(issue.message));
  }
  return Object.freeze(groups.map((group) => Object.freeze({ path: Object.freeze(group.path), messages: Object.freeze(group.messages) })));
}
