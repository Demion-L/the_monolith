const MONOLITH_RELATIONSHIP_FIELDS = new Set([
  'related_decisions',
  'related_hypotheses',
  'related_regions',
  'related_protocols',
  'depends_on',
  'references',
  'related',
  // Added in Story 1.3.2: fields actually used in the MONOLITH docs/ corpus
  'follow_up_adrs',
  'related_adrs',
  'related_research',
]);

export interface FrontmatterField {
  key: string;
  values: string[];
  isRelationship: boolean;
}

export interface FrontmatterParseResult {
  fields: FrontmatterField[];
  bodyStartLine: number;
}

export function parseFrontmatter(lines: string[]): FrontmatterParseResult | null {
  if (lines[0]?.trim() !== '---') return null;

  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return null;

  const fmLines = lines.slice(1, closeIdx);
  const fields: FrontmatterField[] = [];

  let i = 0;
  while (i < fmLines.length) {
    const line = fmLines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }

    const keyValueMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!keyValueMatch) {
      i++;
      continue;
    }

    const key = keyValueMatch[1];
    const rawValue = keyValueMatch[2].trim();

    let values: string[] = [];

    if (rawValue === '') {
      // Block sequence: look ahead for `- item` lines
      i++;
      while (i < fmLines.length) {
        const itemMatch = fmLines[i].match(/^\s+-\s+(.+)$/);
        if (itemMatch) {
          const v = stripQuotes(itemMatch[1].trim());
          if (v) values.push(v);
          i++;
        } else {
          break;
        }
      }
    } else if (rawValue.startsWith('[')) {
      // Inline sequence: [val1, val2]
      const inner = rawValue.slice(rawValue.indexOf('[') + 1, rawValue.lastIndexOf(']'));
      values = inner
        .split(',')
        .map(s => stripQuotes(s.trim()))
        .filter(Boolean);
      i++;
    } else {
      values = [stripQuotes(rawValue)].filter(Boolean);
      i++;
    }

    if (values.length > 0) {
      fields.push({
        key,
        values,
        isRelationship: MONOLITH_RELATIONSHIP_FIELDS.has(key),
      });
    }
  }

  return { fields, bodyStartLine: closeIdx + 1 };
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}
