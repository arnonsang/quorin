---
tags: [skill-creator]
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

I'm starting an npm package called acme-client that wraps the Acme REST API and I want to build it on quorin. Public methods should return quorin SafeResults instead of throwing, and consumers will want to check failures by a code like TIMEOUT or RATE_LIMITED. Set up package.json and write src/client.ts with an AcmeClient class that has getInvoice(id, options?) to start.
