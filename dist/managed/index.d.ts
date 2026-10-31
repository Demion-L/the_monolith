/**
 * Managed blocks (DX-UPDATE-003): the one mechanism by which `monolith init`
 * and `monolith update` put MONOLITH-owned text into a file the user also owns
 * (CLAUDE.md, AGENTS.md, routing-map, skills index) or into a MONOLITH-owned
 * file the user may extend (`AGENT.md`).
 *
 *   <!-- monolith:begin <id> sha256=<16 hex of the body> -->
 *   ...body...
 *   <!-- monolith:end <id> -->
 *
 * The checksum is what makes a refresh safe without a stored template version:
 * a block whose body still matches its own checksum was never edited, so it is
 * ours to refresh; a block that does not match carries a user edit and is left
 * alone (CONFLICT). Everything outside the markers is never read for meaning
 * and never changed. Markers inside fenced code blocks are examples, not blocks.
 * This is not a Markdown parser: it knows lines, fences and these markers.
 */
export declare const BLOCK_IDS: readonly ["bootstrap", "agent", "routing-idea", "index-idea"];
export type BlockId = (typeof BLOCK_IDS)[number];
/** `{{MANAGED_<ID>}}` placeholder name used by the init templates. */
export declare function placeholderFor(id: BlockId): string;
export declare function bodyHash(body: string): string;
/** The body of a block for a given instance root. */
export declare function blockBody(id: BlockId, monolithRoot: string): string;
/** The block as it is written to a file (markers + body), ending in a newline. */
export declare function renderBlock(id: BlockId, body: string, eol?: string): string;
export type BlockState = {
    state: 'absent';
}
/** Exactly one well-formed block whose body matches its checksum. `current`: also equals the template. */
 | {
    state: 'pristine';
    current: boolean;
    from: number;
    to: number;
    lines: string[];
} | {
    state: 'edited';
    detail: string;
} | {
    state: 'malformed';
    detail: string;
};
/** Classify `id` in `text` against the template body `desired`. */
export declare function inspectBlock(text: string, id: BlockId, desired: string): BlockState;
/** `text` plus the block, appended; every existing byte stays in place. */
export declare function appendBlock(text: string, id: BlockId, body: string): string;
/** `text` with only the lines of the block replaced. */
export declare function refreshBlock(text: string, state: Extract<BlockState, {
    state: 'pristine';
}>, id: BlockId, body: string): string;
export type Planned = {
    ok: true;
    content: string;
} | {
    ok: false;
    detail: string;
};
/**
 * `text` with the block appended, or the reason that is not safe. Safe means the
 * result, read back by `inspectBlock`, shows exactly one well-formed, unedited
 * block that equals the template, and every original byte is still in place.
 * An unclosed code fence in `text` swallows the new markers (the next run would
 * not see the block and append another), so it is refused up front.
 */
export declare function planAppend(text: string, id: BlockId, body: string): Planned;
/** `text` with the block refreshed in place, or the reason that is not safe (see `planAppend`). */
export declare function planRefresh(text: string, state: Extract<BlockState, {
    state: 'pristine';
}>, id: BlockId, body: string): Planned;
/** Text with fenced code blocks and HTML comments removed: what an assistant reads as instructions. */
export declare function prose(text: string): string;
//# sourceMappingURL=index.d.ts.map