import { type ProjectFileErrorCode } from '../root/index.js';
import type { SourceErrorCode, SourceStatus } from './types.js';
/**
 * Exhaustive over Core's `ProjectFileErrorCode`: a new Core code is a compile
 * error here until it is mapped. The status of a security violation is NOT
 * decided here — `sourceFailure` takes it from Core's `isReadSecurityViolation`,
 * so the UI keeps no second classification of filesystem security. The
 * 'forbidden' entries only document that and are checked against Core in tests.
 */
export declare const FILE_CODE_MAP: Readonly<Record<ProjectFileErrorCode, readonly [SourceStatus, SourceErrorCode]>>;
/** Never maps a security violation to anything but 'forbidden'; no default for unknown codes. */
export declare function sourceFailure(code: ProjectFileErrorCode): [SourceStatus, SourceErrorCode];
//# sourceMappingURL=source-failure.d.ts.map