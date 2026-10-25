---
type: llm
focus: trace
weight: 1
---

withResilience is called with retries 2, retrySafe true, attemptTimeoutMs 2000, and a shouldRetry that returns true only for HTTP 503 or network (TypeError) failures
