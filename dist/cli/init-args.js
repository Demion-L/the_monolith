const KNOWN_INIT_FLAGS = new Set(['--yes', '-y']);
/**
 * Parses args after `monolith init`. There is no positional target-directory
 * argument — init always scaffolds process.cwd() — so any arg that isn't a
 * known flag is an explicit error, not a silently ignored no-op (see
 * LESSON-2026-0006 / TD-007: a stray positional arg was previously dropped
 * on the floor and the CLI scaffolded the current directory instead).
 */
export function parseInitArgs(args) {
    const unknown = args.filter((arg) => !KNOWN_INIT_FLAGS.has(arg));
    if (unknown.length > 0) {
        return {
            ok: false,
            message: `Unknown argument(s) for 'monolith init': ${unknown.join(' ')}\n` +
                '\n' +
                "  monolith init takes no positional arguments — it always scaffolds\n" +
                '  the current working directory. There is no way to target another\n' +
                '  directory; `cd` there first.\n' +
                '\n' +
                '  Usage: monolith init [--yes|-y]',
        };
    }
    return { ok: true, yes: args.includes('--yes') || args.includes('-y') };
}
