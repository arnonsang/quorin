---
tags: [skill-creator]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Using senu and zod, write src/server.ts for a small Hono or plain fetch-handler app: parse env (PORT number default 3000, DATABASE_URL url) at startup, and a POST /orders handler that validates { sku: string, quantity: positive int } and calls createOrder(input) from ./db. Invalid bodies should get a 400 with the field errors, anything else that fails should be a 500.
