export interface FrontmatterField {
    key: string;
    values: string[];
    isRelationship: boolean;
    /** 0-based line of the key within the artifact (the opening `---` is line 0). */
    line: number;
}
export interface FrontmatterParseResult {
    fields: FrontmatterField[];
    bodyStartLine: number;
}
export declare function parseFrontmatter(lines: string[]): FrontmatterParseResult | null;
//# sourceMappingURL=frontmatter.d.ts.map