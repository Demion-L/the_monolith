export declare const git: (dir: string, ...args: string[]) => string;
export declare function makeProject(opts?: {
    git?: boolean;
}): Promise<string>;
export declare function commitAll(dir: string, msg: string): void;
export declare function write(dir: string, rel: string, text: string): void;
export declare function adr(dir: string, n: number, status: string | null, extra?: string): void;
export declare function finalizedStory(dir: string, phase: string, id: string): void;
export declare function roadmap(dir: string, stories: string[], active?: string): void;
export declare function activeStory(dir: string, id: string | null): void;
/** A mission with optional checkpoints, finished or left in progress. */
export declare function mission(dir: string, o: {
    title?: string;
    story?: string;
    checkpoints?: number;
    result?: 'completed' | 'failed' | 'cancelled';
}): Promise<string>;
//# sourceMappingURL=handover-fixture.d.ts.map