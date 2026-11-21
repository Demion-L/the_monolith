/**
 * Conservative classification of a host tool call (Claude Code PreToolUse) for Managed Execution.
 *
 * This is NOT a shell parser. File tools are classified by name; a Bash command is "read-only" only when it is a
 * single simple command (or a plain `|` pipeline of them) made of tokens that can be checked by exact comparison
 * against a short allowlist. Anything else — redirections, substitutions, `&&`, `;`, quoting, environment prefixes,
 * unknown programs — is UNCLASSIFIED and, in managed mode, treated as a potential write. False positives merely
 * enrol a Mission earlier; a false negative is never produced for the shapes handled here.
 *
 * Boundary: only calls the host routes through the hook are classified. A write made by a program that a command
 * runs (a build, a test run, an editor) is invisible to this layer; it is why such commands count as unclassified.
 */
export type ActionClass = 
/** Modifies (or may modify) the project: requires enrolment in managed mode. */
'implementation'
/** Known not to modify the project. */
 | 'read'
/** A file tool aimed outside the worktree (scratch, home): not a project modification. */
 | 'external'
/** MONOLITH's own CLI: governed by its own contracts (mission/evidence/finalize approvals). */
 | 'governed'
/** A tool this layer does not understand (e.g. MCP tools). Not controlled; not claimed to be covered. */
 | 'uncontrolled';
export interface Classification {
    action: ActionClass;
    reason: string;
}
export declare function classifyBashCommand(command: string): Classification;
/** True when `target` (resolved against `cwd`) lies inside `worktree`. Symlinks of existing ancestors are resolved. */
export declare function isInsideWorktree(target: string, cwd: string, worktree: string): boolean;
export declare function classifyToolUse(toolName: string | undefined, toolInput: unknown, cwd: string, worktree: string): Classification;
//# sourceMappingURL=classify.d.ts.map