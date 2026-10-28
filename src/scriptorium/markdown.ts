import type { HeadingLevel } from './types.js';

export interface ParsedHeading {
  level: HeadingLevel;
  text: string;
  line: number;
  /** Raw id from a trailing `{#ID}` marker (not validated); the marker is removed from `text`. */
  anchorId?: string;
}

export interface ParsedLink {
  label: string;
  target: string;
  line: number;
}

export interface ParsedListItem {
  text: string;
  line: number;
  indent: number;
}

export interface ParsedCodeBlock {
  language: string | undefined;
  content: string;
  startLine: number;
}

export interface MarkdownParseResult {
  headings: ParsedHeading[];
  links: ParsedLink[];
  listItems: ParsedListItem[];
  codeBlocks: ParsedCodeBlock[];
}

const HEADING_RE = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/;
const LIST_ITEM_UNORDERED_RE = /^(\s*)[-*+]\s+(.+)$/;
const LIST_ITEM_ORDERED_RE = /^(\s*)\d+\.\s+(.+)$/;
const HEADING_ANCHOR_RE = /\s*\{#([^\s{}]+)\}\s*$/;
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

export function parseMarkdownBody(lines: string[]): MarkdownParseResult {
  const headings: ParsedHeading[] = [];
  const links: ParsedLink[] = [];
  const listItems: ParsedListItem[] = [];
  const codeBlocks: ParsedCodeBlock[] = [];

  let inCodeBlock = false;
  let codeBlockLang: string | undefined;
  let codeBlockLines: string[] = [];
  let codeBlockStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        const lang = trimmed.slice(3).trim();
        codeBlockLang = lang || undefined;
        codeBlockLines = [];
        codeBlockStart = i;
      } else {
        if (codeBlockLines.join('\n').trim()) {
          codeBlocks.push({
            language: codeBlockLang,
            content: codeBlockLines.join('\n'),
            startLine: codeBlockStart,
          });
        }
        inCodeBlock = false;
        codeBlockLang = undefined;
        codeBlockLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    const headingMatch = trimmed.match(HEADING_RE);
    if (headingMatch) {
      const level = headingMatch[1].length as HeadingLevel;
      let text = headingMatch[2].trim();
      let anchorId: string | undefined;
      const anchor = text.match(HEADING_ANCHOR_RE);
      if (anchor) {
        anchorId = anchor[1];
        text = text.slice(0, anchor.index).trim();
      }
      headings.push({ level, text, line: i, ...(anchorId !== undefined ? { anchorId } : {}) });
      extractLinks(text, i, links);
      continue;
    }

    const unordered = line.match(LIST_ITEM_UNORDERED_RE);
    if (unordered) {
      listItems.push({ text: unordered[2].trim(), line: i, indent: unordered[1].length });
      extractLinks(unordered[2], i, links);
      continue;
    }

    const ordered = line.match(LIST_ITEM_ORDERED_RE);
    if (ordered) {
      listItems.push({ text: ordered[2].trim(), line: i, indent: ordered[1].length });
      extractLinks(ordered[2], i, links);
      continue;
    }

    extractLinks(line, i, links);
  }

  // Close an unclosed fence
  if (inCodeBlock && codeBlockLines.join('\n').trim()) {
    codeBlocks.push({
      language: codeBlockLang,
      content: codeBlockLines.join('\n'),
      startLine: codeBlockStart,
    });
  }

  return { headings, links, listItems, codeBlocks };
}

function extractLinks(text: string, lineIdx: number, out: ParsedLink[]): void {
  const re = new RegExp(LINK_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push({ label: match[1].trim(), target: match[2].trim(), line: lineIdx });
  }
}
