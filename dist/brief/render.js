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
 *   BUDGET_EXCEEDED_BY_REQUIRED and nothing else is attempted.
 *
 *   Phase 2 — whatever chars remain after P0 + the reserved Completeness
 *   line are handed to P1, then P2, then P3, in that fixed order. Each
 *   section either fits whole, or (list sections) includes as many whole
 *   items as fit plus an explicit "N more omitted" marker, or (the Story
 *   excerpt) is field-truncated with an explicit `[truncated N chars]`
 *   marker, or is omitted outright with a one-line marker. Every one of
 *   these outcomes is itself measured and subtracted from the remaining
 *   budget before the next section is attempted — nothing is added "for
 *   free" after the fact.
 */
import { ACTIVE_MD_REL } from './constants.js';
export const DEFAULT_MAX_CHARS = 6000;
const RECENT_FINISHED_MISSIONS_RENDER_LIMIT = 5;
const COMPLETE_LINE = 'Completeness: COMPLETE';
const INCOMPLETE_LINE = 'Completeness: INCOMPLETE';
const RESERVED_COMPLETENESS_LEN = Math.max(COMPLETE_LINE.length, INCOMPLETE_LINE.length) + 1;
const BUDGET_EXCEEDED_LINE = 'BUDGET_EXCEEDED_BY_REQUIRED: required (P0) content exceeds --max-chars; shown in full regardless.';
function formatDiagnosticsBlock(diagnostics, extraLine) {
    const lines = diagnostics.map((d) => `  [${d.severity.toUpperCase()}] ${d.code}: ${d.message}`);
    if (extraLine)
        lines.push(`  [ERROR] ${extraLine}`);
    const body = lines.length > 0 ? lines.join('\n') + '\n' : '  (none)\n';
    return `\n## Diagnostics\n${body}`;
}
function formatStateKeeperBlock(sk) {
    const versionNote = sk.schemaVersionOnDisk !== undefined ? ` schemaVersionOnDisk=${sk.schemaVersionOnDisk}` : '';
    return `\n## State Keeper\n  status: ${sk.status}${versionNote}\n  (source: ${sk.provenance.source})\n`;
}
function formatMission(m) {
    return `  - ${m.id} [${m.status}] ${m.title} (${m.system}) — started ${m.startedAt}\n`;
}
function formatActiveMissionsBlock(missions, provenance) {
    const body = missions.length > 0 ? missions.map(formatMission).join('') : '  (none)\n';
    return `\n## Active Missions (${missions.length})\n${body}  (source: ${provenance.source})\n`;
}
function formatDocRef(d) {
    return `  - ${d.id}: ${d.title} (${d.path})\n`;
}
function formatProtocolsBlock(items, provenance) {
    const body = items.length > 0 ? items.map(formatDocRef).join('') : '  (none)\n';
    return `\n## Mandatory Protocols (${items.length})\n${body}  (source: ${provenance.source})\n`;
}
function buildCoreP0(model, includeBudgetExceeded) {
    const title = `\n# MONOLITH Brief — ${model.identity.name}\n(monolithRoot: ${model.identity.monolithRoot}, source: ${model.identity.provenance.source})\n`;
    return (title +
        formatStateKeeperBlock(model.stateKeeper) +
        formatDiagnosticsBlock(model.diagnostics, includeBudgetExceeded ? BUDGET_EXCEEDED_LINE : null) +
        formatActiveMissionsBlock(model.missions.active, model.missions.provenance) +
        formatProtocolsBlock(model.mandatoryProtocols.items, model.mandatoryProtocols.provenance));
}
/** Truncates `text` to fit within `maxBodyLen`, appending an explicit, pointer-bearing marker. */
function truncateToBudget(text, maxBodyLen, pointer) {
    if (text.length <= maxBodyLen)
        return text;
    const removed = text.length - maxBodyLen;
    const marker = `\n[truncated ${removed} chars — see ${pointer}]`;
    const keep = Math.max(0, maxBodyLen - marker.length);
    return text.slice(0, keep) + marker;
}
function buildStorySection(model, remaining) {
    const header = '\n## Current Story\n';
    const pointer = model.story.provenance?.source ?? ACTIVE_MD_REL;
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
        body = `${model.story.excerpt ?? ''}\n`;
    }
    const provenanceLine = model.story.provenance ? `  (source: ${model.story.provenance.source})\n` : '';
    const full = header + body + provenanceLine;
    if (full.length <= remaining) {
        return { text: full, consumed: full.length, lossFlag: false };
    }
    if (model.story.excerpt) {
        const fixedOverhead = header.length + 1 + provenanceLine.length;
        const budgetForBody = remaining - fixedOverhead;
        if (budgetForBody > 0) {
            const truncatedBody = truncateToBudget(model.story.excerpt, budgetForBody, pointer);
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
    return { text: '', consumed: 0, lossFlag: true };
}
function formatCheckpointItem(cp) {
    const lines = [`  - Mission ${cp.missionId}:`];
    if (!cp.latest) {
        lines.push('    Next steps: UNKNOWN (no checkpoints)');
    }
    else {
        lines.push(`    checkpoint: ${cp.latest.id} (createdAt ${cp.latest.createdAt})`);
        lines.push(`    summary: ${cp.latest.summary}`);
        if (cp.latest.remainingSteps.length === 0) {
            lines.push('    Next steps: none recorded');
        }
        else {
            lines.push('    Next steps:');
            for (const step of cp.latest.remainingSteps)
                lines.push(`      - ${step}`);
        }
    }
    lines.push(`    (source: ${cp.provenance.source})`);
    return lines.join('\n') + '\n';
}
function buildCheckpointsSection(model, remaining) {
    if (model.checkpoints.length === 0)
        return { text: '', consumed: 0, lossFlag: false };
    const header = '\n## Active Mission Checkpoints\n';
    const items = model.checkpoints.map(formatCheckpointItem);
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
        marker = `  ...and ${omitted} more mission(s)' checkpoint details omitted (budget) — run \`monolith mission checkpoints <id>\`.\n`;
        while (included.length > 0 && used + marker.length > remaining) {
            const removedItem = included.pop();
            used -= removedItem.length;
            omitted = items.length - included.length;
            marker = `  ...and ${omitted} more mission(s)' checkpoint details omitted (budget) — run \`monolith mission checkpoints <id>\`.\n`;
        }
        if (used + marker.length > remaining) {
            return { text: '', consumed: 0, lossFlag: true };
        }
    }
    if (included.length === 0 && !marker)
        return { text: '', consumed: 0, lossFlag: false };
    const text = header + included.join('') + marker;
    return { text, consumed: text.length, lossFlag: omitted > 0 };
}
/**
 * Generic fitter for a deterministically-ordered list of small, atomic text
 * items: include as many whole items as fit, in order, then an explicit
 * "N more omitted" marker for the rest, then a provenance footer (section 9
 * — every content section names its source). Items are never cut mid-item;
 * the footer is reserved for up front so it is never silently dropped while
 * items still fit.
 */
function fitItemList(header, items, footer, remaining, omittedMarkerFn) {
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
        if (used + marker.length > itemBudget) {
            return { text: '', consumed: 0, lossFlag: true };
        }
    }
    const withFooter = header + included.join('') + marker + footer;
    if (withFooter.length <= remaining) {
        return { text: withFooter, consumed: withFooter.length, lossFlag: omitted > 0 };
    }
    const withoutFooter = header + included.join('') + marker;
    return { text: withoutFooter, consumed: withoutFooter.length, lossFlag: true };
}
const P3_TEXT = '\n## More\n' +
    '  Full checkpoint history: `monolith mission checkpoints <id>`\n' +
    '  Mission detail: `monolith mission show <id>`\n' +
    '  Full ADR/protocol listings: see their directories above.\n';
export function render(model, maxChars = DEFAULT_MAX_CHARS) {
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
        const story = buildStorySection(model, remaining);
        p1 += story.text;
        remaining -= story.consumed;
        budgetLoss = budgetLoss || story.lossFlag;
        const ckpt = buildCheckpointsSection(model, remaining);
        p1 += ckpt.text;
        remaining -= ckpt.consumed;
        budgetLoss = budgetLoss || ckpt.lossFlag;
        const adrItems = model.adrs.items.map((a) => formatDocRef(a));
        const adrSection = fitItemList(`\n## Accepted ADR Index (${model.adrs.items.length})\n`, adrItems, `  (source: ${model.adrs.provenance.source})\n`, remaining, (n) => `  ...and ${n} more ADR(s) omitted (budget) — see ${model.adrs.provenance.source}.\n`);
        p2 += adrSection.text;
        remaining -= adrSection.consumed;
        budgetLoss = budgetLoss || adrSection.lossFlag;
        const recentFinished = model.missions.recentFinished.slice(0, RECENT_FINISHED_MISSIONS_RENDER_LIMIT);
        const finishedItems = recentFinished.map(formatMission);
        const finishedSection = fitItemList(`\n## Recently Finished Missions (${recentFinished.length})\n`, finishedItems, `  (source: ${model.missions.provenance.source})\n`, remaining, (n) => `  ...and ${n} more omitted (budget) — see ${model.missions.provenance.source}.\n`);
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
    const text = `${completenessLine}\n${coreText}${p1}${p2}${p3}`;
    return { text: `${text.replace(/\n+$/, '')}\n`, completeness };
}
