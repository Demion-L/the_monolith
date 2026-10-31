/**
 * `monolith update [--apply]` handler (DX-UPDATE-001). Preview is read-only.
 * Exit codes: 0 ok (preview, or apply with integration complete), 1 error,
 * 2 apply finished but manual actions remain (integration incomplete).
 */
export declare const UPDATE_USAGE = "Usage: monolith update [--apply]\n\nBrings an existing MONOLITH instance up to Idea Capture & Recall.\n  (no flag)  Preview: shows the plan, writes nothing.\n  --apply    Creates the files marked ADD. Nothing else is written.\n\nNever overwrites or edits an existing file: CLAUDE.md, AGENTS.md, the routing\nmap, the skills index, memory, state.json and your own skills are only read.\nWhere they lack the wiring, the plan shows CONFLICT with the exact text to add\nby hand. Instances carry no template version, so components are detected by\ncontent. Safe to re-run. Not transactional and not coordinated between\nsimultaneous runs. Exit code 2 after --apply means manual actions remain.";
export declare function runUpdate(args: string[], targetDir?: string): Promise<number>;
//# sourceMappingURL=cli.d.ts.map