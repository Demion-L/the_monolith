---
type: reference
id: reference-development
authority: authoritative
stability: volatile
---

# Development

```bash
pnpm install
pnpm test            # Core tests (vitest)
pnpm typecheck       # tsc --noEmit
pnpm build           # compile to dist/
pnpm test:ui         # UI tests
pnpm typecheck:ui    # vue-tsc
pnpm build:ui        # build the UI into dist/ui (committed; rebuild after UI changes)
node dist/cli/index.js ui dev    # UI development with hot reload
```

`dist/ui` is tracked in Git and listed in the package `files`, so rebuild it
(`pnpm build:ui`) whenever `ui/` changes. The UI source lives in `ui/`
(Vue 3 + Vite).

Project conventions, source structure and boot sequence: `AGENTS.md`.
