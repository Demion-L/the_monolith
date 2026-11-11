/**
 * A4-SEC-01 / A4-SEC-02 / A4-SEC-04 / L6 — git evidence is parsed structurally and
 * collected read-only, locally and offline. Everything runs against real git in
 * temporary directories outside the project; nothing here talks to a real network.
 *
 * Guiding rule under test: untrustworthy git evidence never yields FRESH.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { collect } from './collect.js';
import { reconcile } from './reconcile.js';
import { MAX_BLOB_BYTES, readBlobAt, readGitSignals } from './git-signals.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'F',
  GIT_AUTHOR_EMAIL: 'f@example.invalid',
  GIT_COMMITTER_NAME: 'F',
  GIT_COMMITTER_EMAIL: 'f@example.invalid',
};
let tick = 0;
function sh(dir: string, args: string[], input?: string): string {
  const stamp = new Date(Date.UTC(2001, 1, 1, 12, 0, ++tick)).toISOString();
  return execFileSync('git', args, {
    cwd: dir,
    env: { ...ENV, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp },
    stdio: ['pipe', 'pipe', 'ignore'],
    input,
    encoding: 'utf8',
  });
}
const put = (dir: string, rel: string, content: string): void => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
};
const commit = (dir: string, msg: string): string => {
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '--allow-empty', '-m', msg]);
  return sh(dir, ['rev-parse', 'HEAD']).trim();
};
const mkTmp = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};

const STATE = [
  '.monolith/memory/working/active.md',
  '.monolith/context/maps/roadmap-index.md',
  '.monolith/memory/working/story-index.md',
  '.monolith/context/boot/HANDOFF.md',
];

/** A MONOLITH project whose first commit is the "last state update". */
function project(): string {
  const dir = mkTmp('monolith-sec01-');
  put(dir, 'monolith.config.json', JSON.stringify({ project: { name: 'fx' }, monolithRoot: '.monolith' }));
  put(dir, STATE[0], '# Active\n\n## Current Story\n\n**Story:** STC-005 — Active\n\n---\n');
  put(dir, STATE[1], '# Roadmap\n\nActive Story: STC-005\n\n| Story | Title | Status | Date |\n| --- | --- | --- | --- |\n| STC-005 | A | IN PROGRESS | d |\n');
  put(dir, STATE[2], '# Stories\n');
  put(dir, STATE[3], '# Handoff\n\nSTC-005 in progress.\n');
  sh(dir, ['init', '-q', '-b', 'main']);
  commit(dir, 'docs: STC-005 state');
  return dir;
}

async function verdict(dir: string) {
  const m = await collect(dir);
  return { fresh: m.freshness!, report: reconcile(m.freshnessEvidence!, m.freshness!) };
}

function signals(dir: string) {
  const s = readGitSignals(dir, STATE);
  if (s.status !== 'ok') throw new Error(`git signals unavailable: ${s.reason}`);
  return s;
}

describe('A4-SEC-01 — commit subjects cannot forge the structure of git output', () => {
  const FAKE = 'a'.repeat(40);
  const subjects: Record<string, (realSha: string) => string> = {
    'RS (\\x1e)': (sha) => `chore: tidy\x1e${FAKE}\x1f2000-01-01T00:00:00+00:00\x1fSTC-005 recorded work`,
    'US (\\x1f)': () => `chore: tidy\x1f2000-01-01T00:00:00+00:00\x1fSTC-005 recorded work`,
    'RS+US combination, real sha forged twice': (sha) => `\x1e${sha}\x1f2000-01-01T00:00:00+00:00\x1fSTC-005\x1e${sha}\x1f\x1e\x1e\x1f\x1f`,
    'a file-list lookalike': () => 'chore: tidy\x1e' + 'b'.repeat(40) + '\x1f2000-01-01T00:00:00+00:00\x1fx\nsrc/innocent.md',
    'other control characters': () => 'chore: tidy\x01\x02\x07\x1b[2J\x7f ',
  };

  for (const [name, subject] of Object.entries(subjects)) {
    it(`${name}: shas, subjects, dates and file lists are exactly what git recorded`, () => {
      const dir = project();
      const base = sh(dir, ['rev-parse', 'HEAD']).trim();
      put(dir, 'src/pay.ts', 'export const a = 1;\n');
      const evilMsg = subject(base);
      const sha = commit(dir, evilMsg);
      const s = signals(dir);
      expect(s.commitsSince).toHaveLength(1);
      expect(s.commitsSince[0].sha).toBe(sha);
      expect(s.commitsSince[0].files).toEqual(['src/pay.ts']);
      // The subject is data, verbatim as git reports it (git joins a first paragraph into one line).
      expect(s.commitsSince[0].subject).toBe(sh(dir, ['log', '-1', '--format=%s']).replace(/\n$/, ''));
      expect(s.truncated).toBe(false);
    });

    it(`${name}: a src/ change is never FRESH (Freshness) and is reported (--reconcile)`, async () => {
      const dir = project();
      const base = sh(dir, ['rev-parse', 'HEAD']).trim();
      put(dir, 'src/pay.ts', 'export const a = 1;\n');
      // The real subject names no work item; the forged part only *claims* one, and must not be believed.
      // (A subject that genuinely names a recorded work item is FRESH by the existing, documented semantics.)
      commit(dir, subject(base).replace(/STC-005/g, 'zzz').replace(new RegExp(base, 'g'), 'a'.repeat(40)));
      const { fresh, report } = await verdict(dir);
      expect(fresh.status).not.toBe('FRESH');
      expect(report.freshness).toBe(fresh.status);
      expect(JSON.stringify(report.findings)).toContain('commit');
    });
  }

  it('a change under .monolith/protocols is activity (not a state document) and cannot hide behind an injected record', async () => {
    const dir = project();
    put(dir, '.monolith/protocols/governance/core-invariants.md', '# changed\n');
    commit(dir, 'chore: tidy\x1e' + 'c'.repeat(40) + '\x1f2000-01-01T00:00:00+00:00\x1fclaims-recorded-work');
    const s = signals(dir);
    expect(s.commitsSince[0].files).toEqual(['.monolith/protocols/governance/core-invariants.md']);
    expect((await verdict(dir)).fresh.status).not.toBe('FRESH');
  });

  it('duplicate shas / structurally contradictory output are rejected, never trusted (NUL in a commit message)', async () => {
    const dir = project();
    const tree = sh(dir, ['rev-parse', 'HEAD^{tree}']).trim();
    const parent = sh(dir, ['rev-parse', 'HEAD']).trim();
    // git itself refuses a NUL byte in a message when committing; craft the raw object instead.
    const forged = `${'d'.repeat(40)}\0${'2000-01-01T00:00:00+00:00'}\0forged`;
    const raw = `tree ${tree}\nparent ${parent}\nauthor F <f@example.invalid> 981028800 +0000\ncommitter F <f@example.invalid> 981028800 +0000\n\nsubject${forged}\n`;
    let sha: string;
    try {
      sha = sh(dir, ['hash-object', '-t', 'commit', '-w', '--stdin'], raw).trim();
    } catch {
      return; // git refused to create such an object at all — nothing to parse
    }
    sh(dir, ['update-ref', 'HEAD', sha]);
    const s = readGitSignals(dir, STATE);
    if (s.status === 'ok') {
      // If git truncates at the NUL the record is simply "subject" and everything is consistent; a forged second record must not appear.
      expect(s.commitsSince.map((c) => c.sha)).toEqual([sha]);
      expect(s.commitsSince[0].files).toEqual([]);
    } else {
      expect(s.reason).toBe('GIT_OUTPUT_INVALID');
    }
    expect((await verdict(dir)).fresh.status).not.toBe('FRESH');
  });
});

describe('A4-SEC-01/04 — unusual file names are preserved exactly', () => {
  it('whitespace-only, unicode, newline and control-character names, several files in one commit', async () => {
    const dir = project();
    const names = ['   ', 'docs/документ-é.md', 'weird\nname.txt', 'ctl\x1e\x1fname', 'a b.ts', 'src/ordinary.ts', '\ttab'];
    for (const n of names) put(dir, n, 'x\n');
    commit(dir, 'chore: files');
    const s = signals(dir);
    expect([...s.commitsSince[0].files].sort()).toEqual([...names].sort());
    // The old parser dropped the whitespace-only name; a commit changing only that file looked like "no activity" → FRESH.
    const only = project();
    put(only, '   ', 'x\n');
    commit(only, 'chore: spaces');
    const sp = signals(only);
    expect(sp.commitsSince[0].files).toEqual(['   ']);
    const { fresh } = await verdict(only);
    expect(fresh.status).toBe('UNKNOWN');
    expect(fresh.reasons.some((r) => r.code === 'UNATTRIBUTED_ACTIVITY')).toBe(true);
  });

  it('a file named like a commit id or a raw-diff header cannot start a record', () => {
    const dir = project();
    const base = sh(dir, ['rev-parse', 'HEAD']).trim();
    put(dir, base, 'x\n');
    put(dir, ':000000 100644 0000000000000000000000000000000000000000 ef49dd86a6957875edcd0bff210337d6b6dd063c A', 'y\n');
    const sha = commit(dir, 'chore: lookalikes');
    const s = signals(dir);
    expect(s.commitsSince).toHaveLength(1);
    expect(s.commitsSince[0].sha).toBe(sha);
    expect(s.commitsSince[0].files).toHaveLength(2);
    expect(s.commitsSince[0].files).toContain(base);
  });

  it('state documents are recognised by exact path even next to look-alikes', async () => {
    const dir = project();
    put(dir, `${STATE[0]} `, 'trailing-space sibling\n');
    commit(dir, 'docs: sibling file');
    const s = signals(dir);
    expect(s.commitsSince[0].files).toContain(`${STATE[0]} `);
    expect((await verdict(dir)).fresh.status).not.toBe('FRESH');
  });

  it('empty commits and empty / non-git inputs degrade safely', () => {
    const dir = project();
    commit(dir, 'chore: empty');
    expect(signals(dir).commitsSince[0].files).toEqual([]);
    const plain = mkTmp('monolith-nogit-');
    expect(readGitSignals(plain, STATE)).toEqual({ status: 'unavailable', reason: 'NOT_A_GIT_REPOSITORY' });
    const fresh = mkTmp('monolith-nocommit-');
    sh(fresh, ['init', '-q', '-b', 'main']);
    expect(readGitSignals(fresh, STATE)).toMatchObject({ status: 'ok', lastStateUpdate: null, commitsSince: [] });
  });

  it('detached HEAD is read like any other', async () => {
    const dir = project();
    const sha = commit(dir, 'docs: STC-005 more');
    put(dir, 'src/a.ts', '1\n');
    commit(dir, 'feat: STC-005 work');
    sh(dir, ['checkout', '-q', '--detach', 'HEAD']);
    const s = signals(dir);
    expect(s.commitsSince.map((c) => c.subject)).toEqual(['feat: STC-005 work', 'docs: STC-005 more']);
    expect(sha).toBeTruthy();
    expect((await verdict(dir)).fresh.status).toBe('FRESH');
  });

  it('git failing (corrupted repository) is UNKNOWN, never FRESH', async () => {
    const dir = project();
    put(dir, 'src/a.ts', '1\n');
    commit(dir, 'feat: STC-005 work');
    writeFileSync(join(dir, '.git', 'HEAD'), 'garbage\n');
    const { fresh } = await verdict(dir);
    expect(fresh.status).not.toBe('FRESH');
  });
});

describe('L6 — merge commits and shallow clones', () => {
  it('a change made inside a merge commit (conflict resolution / evil merge) is activity', async () => {
    const dir = project();
    sh(dir, ['checkout', '-q', '-b', 'side']);
    put(dir, 'src/side.ts', 's\n');
    commit(dir, 'feat: STC-005 side');
    sh(dir, ['checkout', '-q', 'main']);
    put(dir, 'src/main.ts', 'm\n');
    commit(dir, 'feat: STC-005 main');
    sh(dir, ['merge', '--no-ff', '--no-commit', 'side']);
    put(dir, 'src/smuggled.ts', 'evil\n');
    sh(dir, ['add', '-A']);
    sh(dir, ['commit', '-q', '-m', "Merge branch 'side'"]);
    const s = signals(dir);
    const merge = s.commitsSince[0];
    expect(merge.subject).toBe("Merge branch 'side'");
    expect(merge.files).toEqual(['src/smuggled.ts']);
    const { fresh } = await verdict(dir);
    expect(fresh.status).toBe('UNKNOWN');
  });

  it('a clean merge of recorded work stays FRESH (the merged commits are examined individually)', async () => {
    const dir = project();
    sh(dir, ['checkout', '-q', '-b', 'side']);
    put(dir, 'src/side.ts', 's\n');
    commit(dir, 'feat: STC-005 side');
    sh(dir, ['checkout', '-q', 'main']);
    put(dir, 'src/main.ts', 'm\n');
    commit(dir, 'feat: STC-005 main');
    sh(dir, ['merge', '--no-ff', '-q', 'side', '-m', "Merge branch 'side'"]);
    expect(signals(dir).commitsSince[0].files).toEqual([]);
    expect((await verdict(dir)).fresh.status).toBe('FRESH');
  });

  it('a shallow clone is UNKNOWN (GIT_HISTORY_SHALLOW), not FRESH', async () => {
    const origin = project();
    put(origin, 'src/pay.ts', '1\n');
    commit(origin, 'chore: unattributed change');
    const full = mkTmp('monolith-full-');
    sh(full, ['clone', '-q', `file://${origin}`, 'c']);
    expect((await verdict(join(full, 'c'))).fresh.status).toBe('UNKNOWN'); // the truth
    const shallow = mkTmp('monolith-shallow-');
    sh(shallow, ['clone', '-q', '--depth', '1', `file://${origin}`, 'c']);
    const { fresh, report } = await verdict(join(shallow, 'c'));
    expect(fresh.status).toBe('UNKNOWN');
    expect(fresh.reasons.map((r) => r.code)).toContain('GIT_HISTORY_SHALLOW');
    expect(report.findings.map((f) => f.code)).toContain('GIT_HISTORY_SHALLOW');
  });
});

describe('A4-SEC-02 — no lazy fetch, no network, no object-store writes, no remote-config execution', () => {
  const countObjects = (repo: string): number => {
    let n = 0;
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name));
        else n++;
      }
    };
    walk(join(repo, '.git', 'objects'));
    return n;
  };

  /**
   * origin → partial clone (blob:none) whose promisor remote runs a marker script
   * instead of `git upload-pack`. The only blobs present are the ones checked out.
   */
  function partialClone(): { clone: string; marker: string; ideaCommit: string; ideaBlobPath: string } {
    const base = mkTmp('monolith-lazy-');
    const origin = join(base, 'origin');
    mkdirSync(origin);
    sh(origin, ['init', '-q', '-b', 'main']);
    sh(origin, ['config', 'uploadpack.allowFilter', 'true']);
    sh(origin, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
    put(origin, 'monolith.config.json', JSON.stringify({ project: { name: 'fx' }, monolithRoot: '.monolith' }));
    put(origin, STATE[0], '# Active\n\n## Current Story\n\n**Story:** STC-005 — Active\n');
    put(origin, STATE[1], '# Roadmap\n\nActive Story: STC-005\n');
    put(origin, STATE[2], '# Stories\n');
    put(origin, STATE[3], '# Handoff\n\nSTC-005\n');
    const ideaBlobPath = '.monolith/memory/long-term/ideas/IDEA-001.md';
    put(
      origin,
      ideaBlobPath,
      '---\ntype: idea\nid: "IDEA-001"\ntitle: "t"\nstatus: inbox\ncreatedAt: "2026-11-01T00:00:00.000Z"\npaths: ["docs/vision/p.md"]\n---\n\n## Description\n\nd\n',
    );
    commit(origin, 'docs: STC-005 state');
    put(origin, 'docs/vision/p.md', '# p\n');
    const ideaCommit = commit(origin, 'docs(vision): paper IDEA-001');

    const clone = join(base, 'clone');
    sh(base, ['clone', '-q', '--no-checkout', '--filter=blob:none', `file://${origin}`, 'clone']);
    // Check out only the state documents: the idea blob and the paper stay missing locally.
    sh(clone, ['checkout', 'HEAD~1', '--', 'monolith.config.json', ...STATE]);
    const marker = join(base, 'MARKER');
    const evil = join(base, 'evil.sh');
    writeFileSync(evil, `#!/bin/sh\necho executed >> '${marker}'\nexec git upload-pack "$@"\n`);
    chmodSync(evil, 0o755);
    sh(clone, ['config', 'remote.origin.uploadpack', evil]);
    return { clone, marker, ideaCommit, ideaBlobPath };
  }

  it('control: the hostile setup really does fetch and execute with a plain `git cat-file` (the test is not vacuous)', () => {
    const { clone, marker, ideaCommit, ideaBlobPath } = partialClone();
    const before = countObjects(clone);
    sh(clone, ['cat-file', 'blob', `${ideaCommit}:./${ideaBlobPath}`]);
    expect(existsSync(marker)).toBe(true);
    expect(countObjects(clone)).toBeGreaterThan(before);
  });

  it('readBlobAt on a missing blob returns null: no fetch, no marker, no new objects', () => {
    const { clone, marker, ideaCommit, ideaBlobPath } = partialClone();
    const before = countObjects(clone);
    expect(readBlobAt(clone, ideaCommit, ideaBlobPath)).toBeNull();
    expect(existsSync(marker)).toBe(false);
    expect(countObjects(clone)).toBe(before);
  });

  it('readGitSignals and collect (brief + reconcile) never fetch; the unreadable registration leaves UNKNOWN', async () => {
    const { clone, marker } = partialClone();
    const before = countObjects(clone);
    const s = readGitSignals(clone, STATE);
    expect(s.status).toBe('ok');
    const { fresh, report } = await verdict(clone);
    expect(fresh.status).toBe('UNKNOWN');
    expect(JSON.stringify(report.findings)).toContain('IDEA-001');
    expect(existsSync(marker)).toBe(false);
    expect(countObjects(clone)).toBe(before);
  });

  it('a normal full clone still resolves registered knowledge (no regression)', async () => {
    const { clone: partial } = partialClone();
    const origin = join(dirname(partial), 'origin');
    const full = mkTmp('monolith-fullclone-');
    sh(full, ['clone', '-q', `file://${origin}`, 'c']);
    expect(readBlobAt(join(full, 'c'), sh(join(full, 'c'), ['rev-parse', 'HEAD']).trim(), '.monolith/memory/long-term/ideas/IDEA-001.md')).toContain('IDEA-001');
  });

  it('refuses oversized blobs without reading them, and malformed arguments', () => {
    const dir = project();
    put(dir, 'big.md', 'x'.repeat(MAX_BLOB_BYTES + 1));
    put(dir, 'small.md', 'ok\n');
    const sha = commit(dir, 'chore: blobs');
    expect(readBlobAt(dir, sha, 'big.md')).toBeNull();
    expect(readBlobAt(dir, sha, 'small.md')).toBe('ok\n');
    expect(readBlobAt(dir, sha, 'nope.md')).toBeNull();
    expect(readBlobAt(dir, 'HEAD', 'small.md')).toBeNull();
    expect(readBlobAt(dir, sha, '-x')).toBeNull();
  });
});
