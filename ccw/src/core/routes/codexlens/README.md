# CodexLens Routes

CodexLens-related HTTP endpoints are handled by `ccw/src/core/routes/codexlens-routes.ts`, which delegates to handler modules in this directory. Each handler returns `true` when it handles the current request.

## File Map

- `ccw/src/core/routes/codexlens/utils.ts` – shared helpers (ANSI stripping + robust JSON extraction from CLI output).
- `ccw/src/core/routes/codexlens/index-handlers.ts` – index/project management endpoints:
  - `GET /api/codexlens/indexes`
  - `POST /api/codexlens/clean`
  - `POST /api/codexlens/init`
  - `POST /api/codexlens/cancel`
  - `GET /api/codexlens/indexing-status`
- `ccw/src/core/routes/codexlens/config-handlers.ts` – install/config/environment endpoints:
  - `GET /api/codexlens/status`
  - `GET /api/codexlens/dashboard-init`
  - `POST /api/codexlens/bootstrap`
  - `POST /api/codexlens/uninstall`
  - `GET /api/codexlens/config`
  - `POST /api/codexlens/config`
  - GPU: `GET /api/codexlens/gpu/detect`, `GET /api/codexlens/gpu/list`, `POST /api/codexlens/gpu/select`, `POST /api/codexlens/gpu/reset`
  - Models: `GET /api/codexlens/models`, `POST /api/codexlens/models/download`, `POST /api/codexlens/models/delete`, `GET /api/codexlens/models/info`
  - Env: `GET /api/codexlens/env`, `POST /api/codexlens/env`
- `ccw/src/core/routes/codexlens/semantic-handlers.ts` – semantic search + reranker + SPLADE endpoints:
  - Semantic: `GET /api/codexlens/semantic/status`, `GET /api/codexlens/semantic/metadata`, `POST /api/codexlens/semantic/install`
  - Search: `GET /api/codexlens/search`, `GET /api/codexlens/search_files`, `GET /api/codexlens/symbol`, `POST /api/codexlens/enhance`
  - Reranker: `GET /api/codexlens/reranker/config`, `POST /api/codexlens/reranker/config`, `GET /api/codexlens/reranker/models`, `POST /api/codexlens/reranker/models/download`, `POST /api/codexlens/reranker/models/delete`, `GET /api/codexlens/reranker/models/info`
  - SPLADE: `GET /api/codexlens/splade/status`, `POST /api/codexlens/splade/install`, `GET /api/codexlens/splade/index-status`, `POST /api/codexlens/splade/rebuild`
- `ccw/src/core/routes/codexlens/watcher-handlers.ts` – file watcher endpoints:
  - `GET /api/codexlens/watch/status`
  - `POST /api/codexlens/watch/start`
  - `POST /api/codexlens/watch/stop`
  - Also exports `stopWatcherForUninstall()` used during uninstall flow.

## Notes

- CodexLens CLI output may include logging + ANSI escapes even with `--json`; handlers use `extractJSON()` from `utils.ts` to parse reliably.
