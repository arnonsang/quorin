---
type: llm
focus: trace
weight: 1
---

src/client.ts imports quorin through subpaths such as quorin/resilience or quorin/result and never from quorin/dist
