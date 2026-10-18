import type { StandardSchemaV1 } from './standard-schema.ts';

export class BoundaryValidationError extends Error {
  override name = 'BoundaryValidationError';
  readonly code: 'VALIDATION_FAILED' = 'VALIDATION_FAILED';
  readonly vendor: string;
  readonly issues: readonly StandardSchemaV1.Issue[];

  constructor(vendor: string, issues: readonly StandardSchemaV1.Issue[]) {
    super(`Validation failed (${vendor}) with ${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}`);
    this.vendor = vendor;
    this.issues = Object.freeze([...issues]);
  }
}
