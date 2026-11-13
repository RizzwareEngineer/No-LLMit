# Docs

Every document in this repository, in reading order.

1. [../README.md](../README.md): what No-LLMit is and how to run it locally.
2. [system-design.md](system-design.md): why the system has this shape, with the diagram (`system-design.png`, drawn in `system-design.excalidraw`) and every production setting.
3. [trace.md](trace.md): the code path from the engine starting to pixels on screen, function by function (pictures in `trace/`).
4. [stream.md](stream.md): every message on `GET /stream`, the wire contract between the engine and the site.
5. [hand-history.md](hand-history.md): what is saved for every hand and how to read it ([hand-record-example.json](hand-record-example.json) is one).
6. [stats.md](stats.md): how every stat is counted ([stats-api-contract.json](stats-api-contract.json) is the response shape).
7. [../llm/README.md](../llm/README.md): the LLM service: the prompts, how replies are read, the roster and its prices.
8. [../dataset/README.md](../dataset/README.md): the nightly export to the open dataset.
9. [agent-workflow.md](agent-workflow.md): the test gate and how agent work is merged.
10. [backlog.md](backlog.md): work not started yet.

Also in the repository: [../web/AGENTS.md](../web/AGENTS.md) (written by `next dev`: read Next's own docs before changing `web/`),
[../.github/pull_request_template.md](../.github/pull_request_template.md) (the pull request layout), the `.env.example` file in
`engine/`, `llm/` and `web/` (every setting each one reads), and [table.png](table.png) (the picture in the README).
