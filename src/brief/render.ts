/**
 * `render(model, maxChars)` — the Rendering stage of the brief pipeline.
 *
 * Pure and synchronous: same BriefModel + same maxChars always produces the
 * byte-identical string (section 11 — determinism). No Date.now(), no
 * random IDs, no locale-dependent sorting; every list collect() hands in is
 * already in a fixed, stably-sorted order.
 *
 * Budget accounting (section 10) in two phases to avoid a circular
 * dependency between "does P0 fit" and "what does the Completeness line
 * say" (rule: no diagnostic/marker line may be added without being counted
 * in the budget that decided what else fits):
 *
 *   Phase 1 — build all P0 content (identity, State Keeper status,
 *   collect-time diagnostics, every active mission identifier, every
 *   mandatory protocol pointer) with NO budget limit — P0 is never
 *   truncated or hidden (rule 5/7). If P0 alone (plus the reserved,
 *   fixed-size Completeness line) exceeds maxChars, that is reported via
 *   BUDGET_EXCEEDED_BY_REQUIRED (which also states explicitly that P1–P3
 *   are skipped entirely as a result — review finding F-5) and nothing
 *   else is attempted.
 *
 *   Phase 2 — whatever chars remain after P0 + the reserved Completeness
 *   line are handed to P1 (Checkpoints, then Story — Checkpoints first so
 *   a long Story can never silently starve "Next steps" out of the budget;
 *   review finding F-5), then P2, then P3, in that fixed order. Each
 *   section either fits whole, or (list sections) includes as many whole
 *   items as fit plus an explicit "N more omitted" marker, or (the Story
 *   excerpt) is field-truncated with an explicit `[truncated N chars]`
 *   marker, or — if not even that fits — falls back to a short, fixed-size
 *   local omission marker so a section can never disappear from the output
 *   without some local trace of its omission (review finding F-5; the only
 *   residual case where a section can still vanish with zero local marker
 *   is when `remaining` is too small even for that minimal marker, which
 *   is itself already covered by the global Completeness: INCOMPLETE
 *   signal). Every one of these outcomes is itself measured and subtracted
 *   from the remaining budget before the next section is attempted —
 *   nothing is added "for free" after the fact.
 */

import type { BriefModel, BriefDiagnostic, StateKeeperSummary, Provenance, CheckpointSummary } from './types.js';
import type { Mission } from '../coordinatorium/types.js';
import type { AdrRef, DocRef } from './types.js';
import { ACTIVE_MD_REL } from './constants.js';
import { sanitizeSingleLine, sanitizeMultiLine } from './sanitize.js';

export const DEFAULT_MAX_CHARS = 6000;
const RECENT_FINISHED_MISSIONS_RENDER_LIMIT = 5;

export type Completeness = 'COMPLETE' | 'INCOMPLETE';

export interface RenderResult {
  text: string;
  completeness: Completeness;
}

const COMPLETE_LINE = 'Completeness: COMPLETE';
const INCOMPLETE_LINE = 'Completeness: INCOMPLETE';
const RESERVED_COMPLETENESS_LEN = Math.max(COMPLETE_LINE.length, INCOMPLETE_LINE.length) + 1;

const BUDGET_EXCEEDED_LINE =
  'BUDGET_EXCEEDED_BY_REQUIRED: required (P0) content exceeds --max-chars; shown in full regardless ' +
  '(--max-chars is not honored in this case). Optional sections (Current Story, Active Mission ' +
  'Checkpoints, Accepted ADR Index, Recently Finished Missions) are skipped entirely as a result.';

function formatDiagnosticsBlock(diagnostics: BriefDiagnostic[], extraLine: string | null): string {
  const lines = diagnostics.map((d) => `  [${d.severity.toUpperCase()}] ${d.code}: ${sanitizeSingleLine(d.message)}`);
  if (extraLine) lines.push(`  [ERROR] ${extraLine}`);
  const body = lines.length > 0 ? lines.join('\n') + '\n' : '  (none)\n';
  return `\n## Diagnostics\n${body}`;
}

function formatStateKeeperBlock(sk: StateKeeperSummary): string {
  const versionNote = sk.schemaVersionOnDisk !== undefined ? ` schemaVersionOnDisk=${sk.schemaVersionOnDisk}` : '';
  return `\n## State Keeper\n  status: ${sk.status}${versionNote}\n  (source: ${sk.provenance.source})\n`;
}

function formatMission(m: Mission): string {
  return `  - ${m.id} [${m.status}] ${sanitizeSingleLine(m.title)} (${sanitizeSingleLine(m.system)}) — started ${m.startedAt}\n`;
}

function formatActiveMissionsBlock(missions: Mission[], provenance: Provenance): string {
  const body = missions.length > 0 ? missions.map(formatMission).join('') : '  (none)\n';
  return `\n## Active Missions (${missions.length})\n${body}  (source: ${provenance.source})\n`;
}

function formatDocRef(d: DocRef): string {
  return `  - ${d.id}: ${sanitizeSingleLine(d.title)} (${d.path})\n`;
}

function formatProtocolsBlock(items: DocRef[], provenance: Provenance): string {
  const body = items.length > 0 ? items.map(formatDocRef).join('') : '  (none)\n';
  return `\n## Mandatory Protocols (${items.length})\n${body}  (source: ${provenance.source})\n`;
}

function formatIdentityTitle(model: BriefModel): string {
  return `\n# MONOLITH Brief — ${sanitizeSingleLine(model.identity.name)}\n(monolithRoot: ${model.identity.monolithRoot}, source: ${model.identity.provenance.source})\n`;
}

function buildCoreP0(model: BriefModel, includeBudgetExceeded: boolean): string {
  return (
    formatIdentityTitle(model) +
    formatStateKeeperBlock(model.stateKeeper) +
    formatDiagnosticsBlock(model.diagnostics, includeBudgetExceeded ? BUDGET_EXCEEDED_LINE : null) +
    formatActiveMissionsBlock(model.missions.active, model.missions.provenance) +
    formatProtocolsBlock(model.mandatoryProtocols.items, model.mandatoryProtocols.provenance)
  );
}

/**
 * Truncates `text` to fit within `maxBodyLen`, appending an explicit,
 * pointer-bearing `[truncated N chars — see <pointer>]` marker where N is
 * the actual number of characters removed.
 *
 * Review finding F-4: N depends on the marker's own length (removing more
 * chars to make room for a longer "N" can itself change how many digits N
 * has), so a single-pass `text.length - maxBodyLen` estimate under-reports
 * N by exactly the marker's length. This resolves it as a small fixed-point
 * computation: rebuild the marker from the current estimate, re-derive how
 * much is actually kept, and repeat until N stops changing (converges in at
 * most a couple of iterations — the only way it can change at all is a
 * digit-count crossing in N, which an 8-iteration cap comfortably covers).
 *
 * The cut point is also nudged left by one character if it would otherwise
 * split a UTF-16 surrogate pair, and N is recomputed once more for that
 * final cut point so it stays exact even in that case.
 */
function truncateToBudget(text: string, maxBodyLen: number, pointer: string): string {
  if (text.length <= maxBodyLen) return text;

  const buildMarker = (removed: number): string => `\n[truncated ${removed} chars — see ${pointer}]`;

  let removed = text.length - maxBodyLen;
  let keepLen = 0;
  for (let i = 0; i < 8; i++) {
    const marker = buildMarker(removed);
    keepLen = Math.max(0, maxBodyLen - marker.length);
    const nextRemoved = text.length - keepLen;
    if (nextRemoved === removed) break;
    removed = nextRemoved;
  }

  if (keepLen > 0 && keepLen < text.length) {
    const code = text.charCodeAt(keepLen - 1);
    if (code >= 0xd800 && code <= 0xdbff) keepLen -= 1; // don't split a surrogate pair
  }

  const finalRemoved = text.length - keepLen;
  return text.slice(0, keepLen) + buildMarker(finalRemoved);
}

interface SectionFit {
  text: string;
  consumed: number;
  lossFlag: boolean;
}

/**
 * Absolute last-resort fallback (review finding F-5): a label- and
 * pointer-free marker so short it fits almost any nonzero `remaining`
 * budget. Each section tries its own more informative (labeled,
 * pointer-bearing) fallback first; this is only reached when even that
 * doesn't fit. The only way a section can still end up with zero local
 * trace is `remaining` being smaller than this marker itself — by that
 * point the budget is so exhausted that the global `Completeness:
 * INCOMPLETE` line is the only thing that could fit anyway.
 */
const BARE_OMIT_MARKER = '\n[omitted — budget]\n';

function buildStorySection(model: BriefModel, remaining: number): SectionFit {
  const header = '\n## Current Story\n';
  const pointer = model.story.provenance?.source ?? ACTIVE_MD_REL;
  const minimalFallback = `\n[Story omitted — budget; see ${pointer}]\n`;

  let body: string;
  if (!model.story.fileExists) {
    body = '  (active.md not found)\n';
  } else if (!model.story.hasCurrentStorySection) {
    body = '  (no "Current Story" section found)\n';
  } else if (model.story.excerpt === '') {
    body = '  (section present but empty)\n';
  } else {
    body = `${sanitizeMultiLine(model.story.excerpt ?? '')}\n`;
  }
  const provenanceLine = model.story.provenance ? `  (source: ${model.story.provenance.source})\n` : '';
  const full = header + body + provenanceLine;
  if (full.length <= remaining) {
    return { text: full, consumed: full.length, lossFlag: false };
  }

  if (model.story.excerpt) {
    const sanitizedExcerpt = sanitizeMultiLine(model.story.excerpt);
    const fixedOverhead = header.length + 1 + provenanceLine.length;
    const budgetForBody = remaining - fixedOverhead;
    if (budgetForBody > 0) {
      const truncatedBody = truncateToBudget(sanitizedExcerpt, budgetForBody, pointer);
      const truncatedFull = header + truncatedBody + '\n' + provenanceLine;
      if (truncatedFull.length <= remaining) {
        return { text: truncatedFull, consumed: truncatedFull.length, lossFlag: true };
      }
    }
  }

  const omitLine = `\n## Current Story\n  [omitted — budget] see ${pointer}\n`;
  if (omitLine.length <= remaining) {
    return { text: omitLine, consumed: omitLine.length, lossFlag: true };
  }
  if (minimalFallback.length <= remaining) {
    return { text: minimalFallback, consumed: minimalFallback.length, lossFlag: true };
  }
  if (BARE_OMIT_MARKER.length <= remaining) {
    return { text: BARE_OMIT_MARKER, consumed: BARE_OMIT_MARKER.length, lossFlag: true };
  }
  return { text: '', consumed: 0, lossFlag: true };
}

function formatCheckpointItem(cp: CheckpointSummary): string {
  const lines: string[] = [`  - Mission ${cp.missionId}:`];
  if (!cp.latest) {
    lines.push('    Next steps: UNKNOWN (no checkpoints)');
  } else {
    lines.push(`    checkpoint: ${cp.latest.id} (createdAt ${cp.latest.createdAt})`);
    lines.push(`    summary: ${sanitizeSingleLine(cp.latest.summary)}`);
    if (cp.latest.remainingSteps.length === 0) {
      lines.push('    Next steps: none recorded');
    } else {
      lines.push('    Next steps:');
      for (const step of cp.latest.remainingSteps) lines.push(`      - ${sanitizeSingleLine(step)}`);
    }
  }
  lines.push(`    (source: ${cp.provenance.source})`);
  return lines.join('\n') + '\n';
}

function buildCheckpointsSection(model: BriefModel, remaining: number): SectionFit {
  if (model.checkpoints.length === 0) return { text: '', consumed: 0, lossFlag: false };

  const header = '\n## Active Mission Checkpoints\n';
  const items = model.checkpoints.map(formatCheckpointItem);
  const minimalFallback = '\n[Active Mission Checkpoints omitted — budget; run `monolith mission checkpoints <id>`]\n';
  const makeMarker = (n: number): string =>
    `  ...and ${n} more mission(s)' checkpoint details omitted (budget) — run \`monolith mission checkpoints <id>\`.\n`;

  let used = header.length;
  const included: string[] = [];
  for (const item of items) {
    if (used + item.length <= remaining) {
      included.push(item);
      used += item.length;
    } else {
      break;
    }
  }

  let omitted = items.length - included.length;
  let marker = '';
  if (omitted > 0) {
    marker = makeMarker(omitted);
    while (included.length > 0 && used + marker.length > remaining) {
      const removedItem = included.pop()!;
      used -= removedItem.length;
      omitted = items.length - included.length;
      marker = makeMarker(omitted);
    }
  }

  const fits = omitted === 0 || used + marker.length <= remaining;
  if (fits) {
    if (included.length === 0 && !marker) return { text: '', consumed: 0, lossFlag: false };
    const text = header + included.join('') + marker;
    return { text, consumed: text.length, lossFlag: omitted > 0 };
  }

  if (minimalFallback.length <= remaining) {
    return { text: minimalFallback, consumed: minimalFallback.length, lossFlag: true };
  }
  if (BARE_OMIT_MARKER.length <= remaining) {
    return { text: BARE_OMIT_MARKER, consumed: BARE_OMIT_MARKER.length, lossFlag: true };
  }
  return { text: '', consumed: 0, lossFlag: true };
}

/**
 * Generic fitter for a deterministically-ordered list of small, atomic text
 * items: include as many whole items as fit, in order, then an explicit
 * "N more omitted" marker for the rest, then a provenance footer (section 9
 * — every content section names its source). Items are never cut mid-item;
 * the footer is reserved up front so it is never silently dropped while
 * items still fit. If not even the whole-items-plus-marker form fits, falls
 * back to a short, fixed-size `minimalFallback` marker rather than
 * disappearing without any local trace (review finding F-5).
 */
function fitItemList(
  header: string,
  items: string[],
  footer: string,
  remaining: number,
  omittedMarkerFn: (n: number) => string,
  minimalFallback: string,
): SectionFit {
  const noneBody = '  (none)\n';

  if (items.length === 0) {
    const full = header + noneBody + footer;
    if (full.length <= remaining) return { text: full, consumed: full.length, lossFlag: false };
    const withoutFooter = header + noneBody;
    if (withoutFooter.length <= remaining) return { text: withoutFooter, consumed: withoutFooter.length, lossFlag: false };
    return { text: '', consumed: 0, lossFlag: false };
  }

  const itemBudget = Math.max(0, remaining - footer.length);
  let used = header.length;
  const included: string[] = [];
  for (const item of items) {
    if (used + item.length <= itemBudget) {
      included.push(item);
      used += item.length;
    } else {
      break;
    }
  }

  let omitted = items.length - included.length;
  let marker = '';
  if (omitted > 0) {
    marker = omittedMarkerFn(omitted);
    while (included.length > 0 && used + marker.length > itemBudget) {
      const removedItem = included.pop()!;
      used -= removedItem.length;
      omitted = items.length - included.length;
      marker = omittedMarkerFn(omitted);
    }
  }

  const fits = omitted === 0 || used + marker.length <= itemBudget;
  if (fits) {
    const withFooter = header + included.join('') + marker + footer;
    if (withFooter.length <= remaining) {
      return { text: withFooter, consumed: withFooter.length, lossFlag: omitted > 0 };
    }
    const withoutFooter = header + included.join('') + marker;
    if (withoutFooter.length <= remaining) {
      return { text: withoutFooter, consumed: withoutFooter.length, lossFlag: true };
    }
  }

  if (minimalFallback.length <= remaining) {
    return { text: minimalFallback, consumed: minimalFallback.length, lossFlag: true };
  }
  if (BARE_OMIT_MARKER.length <= remaining) {
    return { text: BARE_OMIT_MARKER, consumed: BARE_OMIT_MARKER.length, lossFlag: true };
  }
  return { text: '', consumed: 0, lossFlag: true };
}

const P3_TEXT =
  '\n## More\n' +
  '  Full checkpoint history: `monolith mission checkpoints <id>`\n' +
  '  Mission detail: `monolith mission show <id>`\n' +
  '  Full ADR/protocol listings: see their directories above.\n';

export function render(model: BriefModel, maxChars: number = DEFAULT_MAX_CHARS): RenderResult {
  const coreText0 = buildCoreP0(model, false);
  const requiredMinimum = coreText0.length + RESERVED_COMPLETENESS_LEN;
  const budgetExceededByRequired = requiredMinimum > maxChars;
  const coreText = budgetExceededByRequired ? buildCoreP0(model, true) : coreText0;

  let remaining = budgetExceededByRequired ? 0 : Math.max(0, maxChars - coreText.length - RESERVED_COMPLETENESS_LEN);
  let budgetLoss = false;
  let p1 = '';
  let p2 = '';
  let p3 = '';

  if (!budgetExceededByRequired) {
    // Checkpoints (carries "Next steps") is given first claim on the P1
    // budget, ahead of Story — a long Story excerpt must not be able to
    // silently starve Next-steps information out of the brief (review
    // finding F-5).
    const ckpt = buildCheckpointsSection(model, remaining);
    p1 += ckpt.text;
    remaining -= ckpt.consumed;
    budgetLoss = budgetLoss || ckpt.lossFlag;

    const story = buildStorySection(model, remaining);
    p1 += story.text;
    remaining -= story.consumed;
    budgetLoss = budgetLoss || story.lossFlag;

    const adrItems = model.adrs.items.map((a: AdrRef) => formatDocRef(a));
    const adrSection = fitItemList(
      `\n## Accepted ADR Index (${model.adrs.items.length})\n`,
      adrItems,
      `  (source: ${model.adrs.provenance.source})\n`,
      remaining,
      (n) => `  ...and ${n} more ADR(s) omitted (budget) — see ${model.adrs.provenance.source}.\n`,
      `\n[Accepted ADR Index omitted — budget; see ${model.adrs.provenance.source}]\n`,
    );
    p2 += adrSection.text;
    remaining -= adrSection.consumed;
    budgetLoss = budgetLoss || adrSection.lossFlag;

    const recentFinished = model.missions.recentFinished.slice(0, RECENT_FINISHED_MISSIONS_RENDER_LIMIT);
    const finishedItems = recentFinished.map(formatMission);
    const finishedSection = fitItemList(
      `\n## Recently Finished Missions (${recentFinished.length})\n`,
      finishedItems,
      `  (source: ${model.missions.provenance.source})\n`,
      remaining,
      (n) => `  ...and ${n} more omitted (budget) — see ${model.missions.provenance.source}.\n`,
      `\n[Recently Finished Missions omitted — budget; see ${model.missions.provenance.source}]\n`,
    );
    p2 += finishedSection.text;
    remaining -= finishedSection.consumed;
    budgetLoss = budgetLoss || finishedSection.lossFlag;

    if (P3_TEXT.length <= remaining) {
      p3 = P3_TEXT;
      remaining -= p3.length;
    }
  }

  const collectTimeError = model.diagnostics.some((d) => d.severity === 'error');
  const completeness: Completeness = !collectTimeError && !budgetExceededByRequired && !budgetLoss ? 'COMPLETE' : 'INCOMPLETE';
  const completenessLine = completeness === 'COMPLETE' ? COMPLETE_LINE : INCOMPLETE_LINE;

  const text = `${completenessLine}\n${coreText}${p1}${p2}${p3}`;
  return { text: `${text.replace(/\n+$/, '')}\n`, completeness };
}
