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
export declare const FINALIZE_STORY_CURRENT = "7db4c463f67317d6d3e16050c3696eafb5d116cf0cb78b5cdf10b22c0c5bb6cc";
//# sourceMappingURL=legacy-skills.d.ts.map