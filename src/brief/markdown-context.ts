/**
 * Markdown context shared by the Brief, Freshness, Reconcile and DOCSYNC
 * readers of the project state documents. Pure, deterministic, no I/O.
 */

/**
 * True when the first visible line of a Current Story excerpt (outside code
 * fences and HTML comments) declares that there is no active story. Shared by
 * the Brief and DOCSYNC (PSC-004A): such a declaration next to a structural
 * `**Story:**` field is a contradiction, never a confirmed "none" and never
 * a confirmed identity.
 */
export function declaresNoActiveStory(excerpt: string): boolean {
  const first = maskNonContent(excerpt.replace(/\r\n/g, '\n')).split('\n').find((l) => l.trim() !== '') ?? '';
  return /^\W*no active story\b/i.test(first);
}

/**
 * Blanks every line (or part of a line) that sits inside a fenced code block
 * or an HTML comment, keeping the line count. Fence grammar matches DOCSYNC's
 * `activeStoryIdentity()`: a line that starts with ``` or ~~~ opens a fence,
 * and only a line made of the same character, at least as long, closes it.
 * An unterminated fence or comment hides the rest of the text — an example
 * that cannot be delimited is never read as a claim.
 */
export function maskNonContent(text: string): string {
  let fence: string | null = null;
  let comment = false;
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const f = /^(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (f !== null && f[1][0] === fence[0] && f[1].length >= fence.length && line === f[1]) fence = null;
      out.push('');
      continue;
    }
    if (!comment && f !== null) {
      fence = f[1];
      out.push('');
      continue;
    }
    let kept = '';
    let i = 0;
    while (i < raw.length) {
      if (comment) {
        const end = raw.indexOf('-->', i);
        if (end === -1) break;
        comment = false;
        i = end + 3;
      } else {
        const start = raw.indexOf('<!--', i);
        if (start === -1) {
          kept += raw.slice(i);
          break;
        }
        kept += raw.slice(i, start);
        comment = true;
        i = start + 4;
      }
    }
    out.push(kept);
  }
  return out.join('\n');
}
