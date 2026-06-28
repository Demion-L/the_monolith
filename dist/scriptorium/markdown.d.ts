import type { HeadingLevel } from './types.js';
export interface ParsedHeading {
    level: HeadingLevel;
    text: string;
    line: number;
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
export declare function parseMarkdownBody(lines: string[]): MarkdownParseResult;
//# sourceMappingURL=markdown.d.ts.map