import type {
  ScriptoriumInput,
  ScriptoriumResult,
  ConceptCandidate,
  RelationshipCandidate,
  Evidence,
  SourceReference,
  ScriptoriumDiagnostic,
} from './types.js';
import { parseFrontmatter } from './frontmatter.js';
import { parseMarkdownBody } from './markdown.js';

export function compileMarkdownArtifact(input: ScriptoriumInput): ScriptoriumResult {
  const { id, content } = input;

  const concepts: ConceptCandidate[] = [];
  const relationships: RelationshipCandidate[] = [];
  const evidence: Evidence[] = [];
  const sourceReferences: SourceReference[] = [];
  const diagnostics: ScriptoriumDiagnostic[] = [];

  let conceptIdx = 0;
  let relIdx = 0;
  let evidenceIdx = 0;
  let refIdx = 0;

  const lines = content.split('\n');

  const fm = parseFrontmatter(lines);
  const bodyStartLine = fm?.bodyStartLine ?? 0;
  const bodyLines = lines.slice(bodyStartLine);

  let docLabel = input.title ?? id;
  let documentId: string | undefined;

  if (fm) {
    for (const field of fm.fields) {
      if (field.key === 'title' && field.values[0]) {
        docLabel = field.values[0];
      }
      if (field.key === 'id' && field.values[0]) {
        documentId = field.values[0];
      }

      if (field.isRelationship) {
        for (const val of field.values) {
          relationships.push({
            id: `${id}-rel-${relIdx++}`,
            fromLabel: docLabel,
            toLabel: val,
            relationshipType: field.key,
            provenance: 'explicit',
            sourceField: field.key,
          });
        }
      } else {
        for (const val of field.values) {
          evidence.push({
            id: `${id}-evidence-${evidenceIdx++}`,
            content: val,
            source: 'frontmatter',
            key: field.key,
          });
        }
      }
    }
  }

  const parsed = parseMarkdownBody(bodyLines);

  for (const heading of parsed.headings) {
    const label = normalizeLabel(heading.text);
    if (!label) continue;
    if (isStructuralHeadingNoise(label)) continue;
    concepts.push({
      id: `${id}-concept-${conceptIdx++}`,
      label,
      source: 'heading',
      headingLevel: heading.level,
      sourceLine: heading.line + bodyStartLine,
    });
  }

  for (const link of parsed.links) {
    sourceReferences.push({
      id: `${id}-ref-${refIdx++}`,
      label: link.label,
      target: link.target,
      sourceLine: link.line + bodyStartLine,
    });
  }

  for (const item of parsed.listItems) {
    if (looksLikeNamedConcept(item.text)) {
      concepts.push({
        id: `${id}-concept-${conceptIdx++}`,
        label: normalizeLabel(item.text),
        source: 'list-item',
        sourceLine: item.line + bodyStartLine,
      });
    } else {
      evidence.push({
        id: `${id}-evidence-${evidenceIdx++}`,
        content: item.text,
        source: 'list-item',
        sourceLine: item.line + bodyStartLine,
      });
    }
  }

  for (const block of parsed.codeBlocks) {
    evidence.push({
      id: `${id}-evidence-${evidenceIdx++}`,
      content: block.content,
      source: 'code-block',
      language: block.language,
      sourceLine: block.startLine + bodyStartLine,
    });
  }

  return {
    artifactId: id,
    documentId,
    documentTitle: docLabel,
    concepts,
    relationships,
    evidence,
    sourceReferences,
    diagnostics,
  };
}

function normalizeLabel(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [label](url) → label
    .replace(/`([^`]*)`/g, '$1')              // `code` → code
    .replace(/[*_~]+/g, '')                   // strip bold/italic markers
    .trim();
}

// Generic structural section titles that appear in almost every document.
// These produce high-degree noise nodes rather than domain-specific concepts.
// Conservative: only exact matches (case-insensitive) after label normalization.
const STRUCTURAL_HEADING_NOISE = new Set([
  'overview',
  'summary',
  'notes',
  'background',
  'context',
  'status',
  'implementation',
  'tests',
  'next steps',
  'open questions',
  'conclusion',
]);

export function isStructuralHeadingNoise(label: string): boolean {
  return STRUCTURAL_HEADING_NOISE.has(label.toLowerCase());
}

// Promotes a list item to a ConceptCandidate if it looks like a named term.
// Conservative heuristic: short (≤3 words), no trailing sentence punctuation,
// and either starts with an uppercase letter or is a backtick-wrapped code term.
function looksLikeNamedConcept(text: string): boolean {
  const label = normalizeLabel(text);
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;
  if (/[.?!,;:]$/.test(label)) return false;
  if (text.trim().startsWith('`')) return true;
  return /^[A-Z]/.test(label);
}
