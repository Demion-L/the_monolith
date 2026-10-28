export declare const DEFAULT_UI_PORT = 4173;
export declare const DEFAULT_DEV_UI_PORT = 5173;
export declare const UI_USAGE: string;
export declare const UI_DEV_USAGE: string;
export type UiArgsResult = {
    ok: true;
    help: false;
    dev: boolean;
    port: number | null;
} | {
    ok: true;
    help: true;
    dev: boolean;
} | {
    ok: false;
    message: string;
};
/**
 * Parses args after `monolith ui`. Anything that is not a known flag, the
 * `dev` subcommand or a valid value is an explicit error (never ignored).
 */
export declare function parseUiArgs(args: string[]): UiArgsResult;
//# sourceMappingURL=ui-args.d.ts.map