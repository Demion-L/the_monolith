/**
 * Known historic bytes of MONOLITH-owned skills (DOGFOOD-002). An installed skill
 * whose sha256 is listed here is an unedited copy of an older template, so
 * replacing it loses nothing. Anything else is the user's text and is never
 * replaced. Hashes are over the file as `init` wrote it (the skill has no
 * `{{VARS}}`, so nothing was substituted).
 */
export declare const FINALIZE_STORY_LEGACY: Readonly<Record<string, string>>;
/**
 * sha256 of the CURRENT `finalize-story` template. A test pins it: editing the template fails
 * that test until the previous hash is moved into FINALIZE_STORY_LEGACY (so instances that
 * carry the unedited previous text keep updating) and this value is replaced.
 */
export declare const FINALIZE_STORY_CURRENT = "de69e1522622c3c7c395d8eb817aa23b8fd21a61bfb507bba342d9699ba55323";
//# sourceMappingURL=legacy-skills.d.ts.map