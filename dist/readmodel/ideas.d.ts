/**
 * Ideas for Mission Control's Knowledge Lab (GOV-EVOLUTION Phase 4).
 *
 * Read-only view over the EXISTING idea store (`src/ideas/`, one Markdown file per idea in
 * `<monolithRoot>/memory/long-term/ideas/`). It reuses the store's safe reader and parser: no
 * second parser, no second storage, nothing written, `.ids/` reservation markers never touched.
 * Idea text is user data: it is carried as plain text and never interpreted or executed.
 *
 * A file that cannot be read as an idea is reported as an issue (fixed code + id), never
 * silently dropped, so the list can say it is not exhaustive. No free-form reader message and
 * no absolute path crosses this boundary.
 */
import type { IdeasData, Section } from './types.js';
export declare const IDEAS_REL = "memory/long-term/ideas";
export declare const MAX_IDEAS = 200;
export declare const MAX_IDEA_DESCRIPTION_CHARS = 8000;
export declare function readIdeas(projectRoot: string, monolithRoot: string): Section<IdeasData>;
//# sourceMappingURL=ideas.d.ts.map