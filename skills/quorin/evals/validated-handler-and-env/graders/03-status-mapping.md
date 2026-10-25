---
type: llm
focus: trace
weight: 1
---

The handler returns 400 with field errors (via formatIssues) when result.error is a BoundaryValidationError and 500 for other failures
