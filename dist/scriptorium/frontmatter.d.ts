export interface FrontmatterField {
    key: string;
    values: string[];
    isRelationship: boolean;
}
export interface FrontmatterParseResult {
    fields: FrontmatterField[];
    bodyStartLine: number;
}
export declare function parseFrontmatter(lines: string[]): FrontmatterParseResult | null;
//# sourceMappingURL=frontmatter.d.ts.map