/**
 * FIX-004C / criterion 70 (AC-A2-1, test 49): one half of the two-process filesystem probe.
 *
 * Test-only; not a runtime component and not a persisted artefact. It touches nothing but the temporary directory it is
 * given. It does NOT prove A2-R: it can refute FS-1…FS-4 on the filesystem under test, nothing more.
 *
 * Per round (both processes released together by the parent through a file barrier):
 *   FS-1  both `link()` their own staging file to the same final name: exactly one wins, the loser sees the winner's
 *         complete bytes (EEXIST), the name is never overwritten.
 *   A:    chain 1  link(segments/S) -> unlink(events/loose);   chain 2  link(P/decision) -> unlink(P/events/old)
 *         then churns names in `churn/` and finally raises a flag file.
 *   B:    lists `churn/` while A churns (FS-4: names present for the whole call must be returned), and after the flag
 *         does link(events/new) -> readdir(segments/) and link(P/events/new) -> readdir(P/) (FS-3), with lstat of the
 *         unlinked names (FS-2). Every violation is recorded, none is fatal.
 */
import fs from 'node:fs';
import { join } from 'node:path';

const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { id, role, root, ctl, rounds } = cfg;
const timeoutMs = cfg.barrierTimeoutMs ?? 60_000;
const pause = new Int32Array(new SharedArrayBuffer(4));
const p = (...a) => join(root, ...a);

function barrier(name) {
  fs.writeFileSync(join(ctl, `${name}.${id}.ready`), '');
  const t0 = Date.now();
  while (!fs.existsSync(join(ctl, `${name}.release`))) {
    if (Date.now() - t0 > timeoutMs) process.exit(99);
    Atomics.wait(pause, 0, 0, 1);
  }
}
const out = (rec) => fs.appendFileSync(join(ctl, `${id}.log`), `${JSON.stringify(rec)}\n`);
const read = (f) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch (e) {
    return `ERR:${e.code}`;
  }
};
const absent = (f) => {
  try {
    fs.lstatSync(f);
    return false;
  } catch (e) {
    return e.code === 'ENOENT';
  }
};
const publish = (staging, dest) => {
  try {
    fs.linkSync(staging, dest);
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }
};

for (let k = 0; k < rounds; k++) {
  barrier(`r${k}`);
  const violations = [];
  const tag = `${role}${k}\n`;
  fs.writeFileSync(p('stage', `${role}_${k}`), tag);
  const won = publish(p('stage', `${role}_${k}`), p('final', `f_${k}`));
  const seen = read(p('final', `f_${k}`));
  if (seen !== `A${k}\n` && seen !== `B${k}\n`) violations.push(`FS1-final-content:${JSON.stringify(seen)}`);
  if (won && seen !== tag) violations.push('FS1-winner-does-not-see-own-bytes');

  if (role === 'A') {
    fs.writeFileSync(p('stage', `seg_${k}`), 'segment\n');
    fs.linkSync(p('stage', `seg_${k}`), p('segments', `S_${k}`));
    fs.unlinkSync(p('events', `loose_${k}`));
    fs.writeFileSync(p('stage', `dec_${k}`), 'commit\n');
    fs.linkSync(p('stage', `dec_${k}`), p('P', `decision_${k}`));
    fs.unlinkSync(p('P', 'events', `old_${k}`));
    for (let j = 0; j < 12; j++) {
      const n = p('churn', `c_${k}_${j}`);
      fs.writeFileSync(n, 'x');
      fs.unlinkSync(n);
    }
    fs.writeFileSync(p('flag', `a_${k}`), '');
    out({ k, role, won, violations });
  } else {
    let lists = 0;
    const spinStart = Date.now();
    while (!fs.existsSync(p('flag', `a_${k}`))) {
      if (Date.now() - spinStart > 30_000) {
        violations.push('probe-timeout-waiting-for-A');
        break;
      }
      const names = fs.readdirSync(p('churn'));
      lists++;
      for (let s = 0; s < 8; s++) if (!names.includes(`stable_${s}`)) violations.push(`FS4-stable-name-missing:stable_${s}`);
    }
    fs.writeFileSync(p('stage', `ev_${k}`), 'event\n');
    publish(p('stage', `ev_${k}`), p('events', `new_${k}`));
    if (!fs.readdirSync(p('segments')).includes(`S_${k}`)) violations.push('FS3-chain1-segment-not-listed');
    if (!absent(p('events', `loose_${k}`))) violations.push('FS2-chain1-unlinked-name-still-visible');
    publish(p('stage', `ev_${k}`), p('P', 'events', `new_${k}`));
    if (!fs.readdirSync(p('P')).includes(`decision_${k}`)) violations.push('FS3-chain2-decision-not-listed');
    if (!absent(p('P', 'events', `old_${k}`))) violations.push('FS2-chain2-unlinked-name-still-visible');
    out({ k, role, won, lists, violations });
  }
}
out({ done: true });
