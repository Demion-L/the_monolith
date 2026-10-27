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
 *
 * Completeness contract (N-3): `Completeness: COMPLETE` means no
 * *substantive data* was lost, not that every section heading is present.
 * An optional section that has nothing to show (an empty list, rendered
 * only as "(none)") and the static P3 pointer block may be dropped under a
 * tight budget without flipping the result to INCOMPLETE — dropping them
 * loses no information. A section that holds data is never dropped
 * silently: it is shown whole, shown partially with an explicit marker, or
 * replaced by a pointer-bearing omission marker, and either of the latter
 * two forces INCOMPLETE. P0 is never dropped. All project-controlled
 * strings, provenance pointers included, pass through
 * `sanitizeSingleLine` (N-1).
 */
import { ACTIVE_MD_REL } from './constants.js';
import { sanitizeSingleLine, sanitizeMultiLine } from './sanitize.js';
// Shorthand for the existing single-line sanitizer — applied to every string
// that originates in project files or configuration (N-1), including
// provenance pointers, which embed config-controlled paths.
const san = sanitizeSingleLine;
export const DEFAULT_MAX_CHARS = 6000;
const RECENT_FINISHED_MISSIONS_RENDER_LIMIT = 5;
const COMPLETE_LINE = 'Completeness: COMPLETE';
const INCOMPLETE_LINE = 'Completeness: INCOMPLETE';
const RESERVED_COMPLETENESS_LEN = Math.max(COMPLETE_LINE.length, INCOMPLETE_LINE.length) + 1;
const BUDGET_EXCEEDED_LINE = 'BUDGET_EXCEEDED_BY_REQUIRED: required (P0) content exceeds --max-chars; shown in full regardless ' +
    '(--max-chars is not honored in this case). Optional sections (Current Story, Active Mission ' +
    'Checkpoints, Accepted ADR Index, Recently Finished Missions) are skipped entirely as a result.';
function formatDiagnosticsBlock(diagnostics, extraLine) {
    const lines = diagnostics.map((d) => `  [${d.severity.toUpperCase()}] ${d.code}: ${sanitizeSingleLine(d.message)}`);
    if (extraLine)
        lines.push(`  [ERROR] ${extraLine}`);
    const body = lines.length > 0 ? lines.join('\n') + '\n' : '  (none)\n';
    return `\n## Diagnostics\n${body}`;
}
function formatStateKeeperBlock(sk) {
    const versionNote = sk.schemaVersionOnDisk !== undefined ? ` schemaVersionOnDisk=${sk.schemaVersionOnDisk}` : '';
    return `\n## State Keeper\n  status: ${sk.status}${versionNote}\n  (source: ${san(sk.provenance.source)})\n`;
}
function formatMission(m) {
    return `  - ${san(m.id)} [${m.status}] ${san(m.title)} (${san(m.system)}) — started ${san(m.startedAt)}\n`;
}
function formatActiveMissionsBlock(missions, provenance) {
    const body = missions.length > 0 ? missions.map(formatMission).join('') : '  (none)\n';
    return `\n## Active Missions (${missions.length})\n${body}  (source: ${san(provenance.source)})\n`;
}
function formatDocRef(d) {
    return `  - ${san(d.id)}: ${san(d.title)} (${san(d.path)})\n`;
}
function formatProtocolsBlock(items, provenance) {
    const body = items.length > 0 ? items.map(formatDocRef).join('') : '  (none)\n';
    return `\n## Mandatory Protocols (${items.length})\n${body}  (source: ${san(provenance.source)})\n`;
}
function formatIdentityTitle(model) {
    return `\n# MONOLITH Brief — ${san(model.identity.name)}\n(monolithRoot: ${san(model.identity.monolithRoot)}, source: ${san(model.identity.provenance.source)})\n`;
}
const ACTIVE_STORY_LABEL = {
    'none-recorded': 'none recorded (this does not mean the project is complete)',
    recorded: 'recorded in active.md',
    unknown: 'unknown',
};
/**
 * SELF-AWARENESS-001: the Freshness block. Part of P0 — it is never truncated,
 * and it never influences `Completeness`. Every string that originates in
 * project files or git history passes through the sanitizer.
 */
function formatFreshnessBlock(f) {
    const lines = ['', '## Freshness', `  Status: ${f.status}`];
    if (f.lastStateUpdate) {
        lines.push(`  Last state update: ${san(f.lastStateUpdate.sha.slice(0, 7))} (${san(f.lastStateUpdate.date.slice(0, 10))}, git)`);
    }
    lines.push(`  Active Story: ${ACTIVE_STORY_LABEL[f.activeStory]}`);
    if (f.reasons.length > 0) {
        lines.push('  Evidence:');
        for (const r of f.reasons)
            lines.push(`    - [${r.code}] ${san(r.message)}`);
    }
    if (f.warnings.length > 0) {
        lines.push('  Warnings:');
        for (const w of f.warnings)
            lines.push(`    - ${san(w)}`);
    }
    lines.push(`  Recommendation: ${san(f.recommendation)}`);
    return lines.join('\n') + '\n';
}
function buildCoreP0(model, includeBudgetExceeded) {
    return (formatIdentityTitle(model) +
        (model.freshness ? formatFreshnessBlock(model.freshness) : '') +
        formatStateKeeperBlock(model.stateKeeper) +
        formatDiagnosticsBlock(model.diagnostics, includeBudgetExceeded ? BUDGET_EXCEEDED_LINE : null) +
        formatActiveMissionsBlock(model.missions.active, model.missions.provenance) +
        formatProtocolsBlock(model.mandatoryProtocols.items, model.mandatoryProtocols.provenance));
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
function truncateToBudget(text, maxBodyLen, pointer) {
    if (text.length <= maxBodyLen)
        return text;
    const buildMarker = (removed) => `\n[truncated ${removed} chars — see ${pointer}]`;
    let removed = text.length - maxBodyLen;
    let keepLen = 0;
    for (let i = 0; i < 8; i++) {
        const marker = buildMarker(removed);
        keepLen = Math.max(0, maxBodyLen - marker.length);
        const nextRemoved = text.length - keepLen;
        if (nextRemoved === removed)
            break;
        removed = nextRemoved;
    }
    if (keepLen > 0 && keepLen < text.length) {
        const code = text.charCodeAt(keepLen - 1);
        if (code >= 0xd800 && code <= 0xdbff)
            keepLen -= 1; // don't split a surrogate pair
    }
    const finalRemoved = text.length - keepLen;
    return text.slice(0, keepLen) + buildMarker(finalRemoved);
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
function buildStorySection(model, remaining) {
    const header = '\n## Current Story\n';
    const pointer = san(model.story.provenance?.source ?? ACTIVE_MD_REL);
    const minimalFallback = `\n[Story omitted — budget; see ${pointer}]\n`;
    let body;
    if (!model.story.fileExists) {
        body = '  (active.md not found)\n';
    }
    else if (!model.story.hasCurrentStorySection) {
        body = '  (no "Current Story" section found)\n';
    }
    else if (model.story.excerpt === '') {
        body = '  (section present but empty)\n';
    }
    else {
        body = `${sanitizeMultiLine(model.story.excerpt ?? '')}\n`;
    }
    const provenanceLine = model.story.provenance ? `  (source: ${san(model.story.provenance.source)})\n` : '';
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
function formatCheckpointItem(cp) {
    const lines = [`  - Mission ${san(cp.missionId)}:`];
    if (!cp.latest) {
        lines.push('    Next steps: UNKNOWN (no checkpoints)');
    }
    else {
        lines.push(`    checkpoint: ${san(cp.latest.id)} (createdAt ${san(cp.latest.createdAt)})`);
        lines.push(`    summary: ${san(cp.latest.summary)}`);
        if (cp.latest.remainingSteps.length === 0) {
            lines.push('    Next steps: none recorded');
        }
        else {
            lines.push('    Next steps:');
            for (const step of cp.latest.remainingSteps)
                lines.push(`      - ${san(step)}`);
        }
    }
    lines.push(`    (source: ${san(cp.provenance.source)})`);
    return lines.join('\n') + '\n';
}
function buildCheckpointsSection(model, remaining) {
    if (model.checkpoints.length === 0)
        return { text: '', consumed: 0, lossFlag: false };
    const header = '\n## Active Mission Checkpoints\n';
    const items = model.checkpoints.map(formatCheckpointItem);
    const minimalFallback = '\n[Active Mission Checkpoints omitted — budget; run `monolith mission checkpoints <id>`]\n';
    const makeMarker = (n) => `  ...and ${n} more mission(s)' checkpoint details omitted (budget) — run \`monolith mission checkpoints <id>\`.\n`;
    let used = header.length;
    const included = [];
    for (const item of items) {
        if (used + item.length <= remaining) {
            included.push(item);
            used += item.length;
        }
        else {
            break;
        }
    }
    let omitted = items.length - included.length;
    let marker = '';
    if (omitted > 0) {
        marker = makeMarker(omitted);
        while (included.length > 0 && used + marker.length > remaining) {
            const removedItem = included.pop();
            used -= removedItem.length;
            omitted = items.length - included.length;
            marker = makeMarker(omitted);
        }
    }
    const fits = omitted === 0 || used + marker.length <= remaining;
    if (fits) {
        if (included.length === 0 && !marker)
            return { text: '', consumed: 0, lossFlag: false };
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
function fitItemList(header, items, footer, remaining, omittedMarkerFn, minimalFallback) {
    const noneBody = '  (none)\n';
    if (items.length === 0) {
        const full = header + noneBody + footer;
        if (full.length <= remaining)
            return { text: full, consumed: full.length, lossFlag: false };
        const withoutFooter = header + noneBody;
        if (withoutFooter.length <= remaining)
            return { text: withoutFooter, consumed: withoutFooter.length, lossFlag: false };
        return { text: '', consumed: 0, lossFlag: false };
    }
    const itemBudget = Math.max(0, remaining - footer.length);
    let used = header.length;
    const included = [];
    for (const item of items) {
        if (used + item.length <= itemBudget) {
            included.push(item);
            used += item.length;
        }
        else {
            break;
        }
    }
    let omitted = items.length - included.length;
    let marker = '';
    if (omitted > 0) {
        marker = omittedMarkerFn(omitted);
        while (included.length > 0 && used + marker.length > itemBudget) {
            const removedItem = included.pop();
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
const P3_TEXT = '\n## More\n' +
    '  Full checkpoint history: `monolith mission checkpoints <id>`\n' +
    '  Mission detail: `monolith mission show <id>`\n' +
    '  Full ADR/protocol listings: see their directories above.\n';
export function render(model, maxChars = DEFAULT_MAX_CHARS) {
    const coreText0 = buildCoreP0(model, false);
    // The Freshness headline sits right under Completeness and is counted in the budget like it.
    const freshnessLine = model.freshness ? `Freshness: ${model.freshness.status}\n` : '';
    const requiredMinimum = coreText0.length + RESERVED_COMPLETENESS_LEN + freshnessLine.length;
    const budgetExceededByRequired = requiredMinimum > maxChars;
    const coreText = budgetExceededByRequired ? buildCoreP0(model, true) : coreText0;
    let remaining = budgetExceededByRequired ? 0 : Math.max(0, maxChars - coreText.length - RESERVED_COMPLETENESS_LEN - freshnessLine.length);
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
        const adrSource = san(model.adrs.provenance.source);
        const missionsSource = san(model.missions.provenance.source);
        const adrItems = model.adrs.items.map((a) => formatDocRef(a));
        const adrSection = fitItemList(`\n## Accepted ADR Index (${model.adrs.items.length})\n`, adrItems, `  (source: ${adrSource})\n`, remaining, (n) => `  ...and ${n} more ADR(s) omitted (budget) — see ${adrSource}.\n`, `\n[Accepted ADR Index omitted — budget; see ${adrSource}]\n`);
        p2 += adrSection.text;
        remaining -= adrSection.consumed;
        budgetLoss = budgetLoss || adrSection.lossFlag;
        const recentFinished = model.missions.recentFinished.slice(0, RECENT_FINISHED_MISSIONS_RENDER_LIMIT);
        const finishedItems = recentFinished.map(formatMission);
        const finishedSection = fitItemList(`\n## Recently Finished Missions (${recentFinished.length})\n`, finishedItems, `  (source: ${missionsSource})\n`, remaining, (n) => `  ...and ${n} more omitted (budget) — see ${missionsSource}.\n`, `\n[Recently Finished Missions omitted — budget; see ${missionsSource}]\n`);
        p2 += finishedSection.text;
        remaining -= finishedSection.consumed;
        budgetLoss = budgetLoss || finishedSection.lossFlag;
        if (P3_TEXT.length <= remaining) {
            p3 = P3_TEXT;
            remaining -= p3.length;
        }
    }
    const collectTimeError = model.diagnostics.some((d) => d.severity === 'error');
    const completeness = !collectTimeError && !budgetExceededByRequired && !budgetLoss ? 'COMPLETE' : 'INCOMPLETE';
    const completenessLine = completeness === 'COMPLETE' ? COMPLETE_LINE : INCOMPLETE_LINE;
    const text = `${completenessLine}\n${freshnessLine}${coreText}${p1}${p2}${p3}`;
    return { text: `${text.replace(/\n+$/, '')}\n`, completeness };
}
