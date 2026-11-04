/**
 * Known historic bytes of MONOLITH-owned skills (DOGFOOD-002). An installed skill
 * whose sha256 is listed here is an unedited copy of an older template, so
 * replacing it loses nothing. Anything else is the user's text and is never
 * replaced. Hashes are over the file as `init` wrote it (the skill has no
 * `{{VARS}}`, so nothing was substituted).
 */
export const FINALIZE_STORY_LEGACY: Readonly<Record<string, string>> = {
  '7a42dbaad1b0908bad820903e2e22b6e06e06f0ddc44d61d003e3cd5ad36f2c6': 'initial template (manual steps only)',
  '8d7011640de68df5e4aad3f1ff5ecf421d1f7a3b454f3c51f12079cfea743b8a': '0.1.0-alpha.0 / alpha.1; manual steps only, no `monolith finalize`',
  '6c41ea1411d1ff75f0db92a80289662e0725a248f243d3065cda0d0452bae194': 'pre-release development template (DOCSYNC-001)',
  '1b8ee0c357de7edb858e211d8a6ae8af1ae0a77a9289259deac25bbcfb138121': 'pre-release development template (DOCSYNC-003)',
  '31cc69d09ba4996f71b497f1f4454912ab497c1bcd766f4b7b337c34384efd2d': '0.1.0-alpha.2; does not forbid manual finalization',
};

/**
 * sha256 of the CURRENT `finalize-story` template. A test pins it: editing the template fails
 * that test until the previous hash is moved into FINALIZE_STORY_LEGACY (so instances that
 * carry the unedited previous text keep updating) and this value is replaced.
 */
export const FINALIZE_STORY_CURRENT = '9a779ee52327b5dfe64917228eb4dda60bf4901e2ac0cd116339eb70d51d2723';
