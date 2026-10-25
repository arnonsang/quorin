---
type: llm
focus: trace
weight: 1
---

src/client.ts imports senu through subpaths such as senu/resilience or senu/result and never from senu/dist
