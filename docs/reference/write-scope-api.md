---
type: reference
id: reference-write-scope-api
authority: authoritative
stability: volatile
---

# Programmatic API: Explicit Write Scope

`mutateState`, `startMission` and `finishMission` no longer accept a plain
directory string; pass a scope ([ADR-012](../adr/ADR-012-safe-writes.md)):

```ts
// before
await startMission(dir, { title, system });
// after — the directory and ALL its ancestors are trusted by the caller
await startMission(trustedDirectoryTarget(dir), { title, system });
// after — acting on a project; nothing below projectRoot may be a symlink
await startMission(projectTarget(projectRoot, join(projectRoot, '.monolith')), { title, system });
```

Calling without a scope throws `SafeWriteError` (`WRITE_SCOPE_REQUIRED`).
Read functions (`readState`, `listMissions`, `getMission`) are unchanged.

The API is alpha and experimental; it may change without notice.
