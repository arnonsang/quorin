---
tags: [skill-creator]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

my node service already depends on quorin. add a getUser(id) in src/users.ts that calls https://api.example.com/users/:id, gives up after 2s per try, retries at most twice but only for 503s or network errors, and caches users for 30s so a burst of requests for the same id only hits the api once. callers should be able to cancel with an AbortSignal
