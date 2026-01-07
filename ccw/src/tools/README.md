# Tools

This directory contains CCW “tools”: self-contained modules that implement concrete functionality (executors, integrations, etc.) that higher-level CLI and route layers call into.

## CLI Executor

The CLI executor is split into focused modules to keep responsibilities clear and keep the public API stable via re-exports.

**Entry point**
- `ccw/src/tools/cli-executor.ts` – thin facade that re-exports from `cli-executor-core.ts` (stable import path for callers).

**Modules**
- `ccw/src/tools/cli-executor-core.ts` – orchestrates tool execution, resume/merge logic, and conversation persistence wiring.
- `ccw/src/tools/cli-executor-utils.ts` – debug logging, tool availability checks (with cache), command building.
- `ccw/src/tools/cli-executor-state.ts` – conversation/history types + SQLite-backed storage helpers.
- `ccw/src/tools/cli-prompt-builder.ts` – prompt concatenation helpers (plain/YAML/JSON) and merged-conversation prompt formatting.

**Dependency flow (high level)**
```
cli-executor.ts
  -> cli-executor-core.ts
      -> cli-executor-utils.ts
      -> cli-executor-state.ts
      -> cli-prompt-builder.ts
```

**Public API**
- Prefer importing from `ccw/src/tools/cli-executor.ts`.
- `cli-executor-core.ts` re-exports prompt helpers/types from `cli-prompt-builder.ts` to preserve existing imports (`PromptConcatenator`, `buildPrompt`, `PromptFormat`, etc.).
