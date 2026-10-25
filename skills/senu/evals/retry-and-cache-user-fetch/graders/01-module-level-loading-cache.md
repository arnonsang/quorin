---
type: llm
focus: trace
weight: 1
---

src/users.ts creates the senu cache once at module scope with a load function and ttlMs of 30000, not inside getUser
