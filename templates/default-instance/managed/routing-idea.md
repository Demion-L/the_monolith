## Table 8 — Knowledge Intent → Canonical Destination

Declarative contract for saving knowledge. It points at existing stores only; it
creates no directory, template or registry. Where truth lives is defined by
`semantic-map.md`.

| Knowledge Intent | Canonical Destination | Required Context | Index |
| ---------------- | --------------------- | ---------------- | ----- |
| `CAPTURE_IDEA`   | The MONOLITH CLI only: `monolith idea add --title "..." (--description "..." \| --description-stdin) [--context "..."]`, which stores `{{MONOLITH_ROOT}}/memory/long-term/ideas/IDEA-NNN.md`. An assistant never chooses the path, never writes or edits an idea file by hand and creates no alternative idea file. An explicit user request to save an idea authorizes the call; the assistant does not capture ideas on its own initiative. Capturing changes no active story, mission, roadmap or focus | `{{MONOLITH_ROOT}}/skills/idea-capture/SKILL.md` | `monolith idea list` (the CLI is the registry) |

**Rules**

1. An intent not listed here has no route: ask the owner, write nothing, create no directory.
2. Save only into the destination named above. Do not create a substitute.
