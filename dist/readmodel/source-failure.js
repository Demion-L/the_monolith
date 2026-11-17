import { isReadSecurityViolation } from '../root/index.js';
/**
 * Exhaustive over Core's `ProjectFileErrorCode`: a new Core code is a compile
 * error here until it is mapped. The status of a security violation is NOT
 * decided here — `sourceFailure` takes it from Core's `isReadSecurityViolation`,
 * so the UI keeps no second classification of filesystem security. The
 * 'forbidden' entries only document that and are checked against Core in tests.
 */
export const FILE_CODE_MAP = {
    FILE_MISSING: ['absent', 'SOURCE_ABSENT'],
    FILE_OUTSIDE_PROJECT: ['forbidden', 'SOURCE_OUTSIDE_PROJECT'],
    FILE_UNRESOLVABLE: ['unreadable', 'SOURCE_UNRESOLVABLE'],
    FILE_NOT_REGULAR: ['forbidden', 'SOURCE_NOT_REGULAR'],
    FILE_EMPTY: ['corrupt', 'SOURCE_EMPTY'],
    FILE_TOO_LARGE: ['unreadable', 'SOURCE_TOO_LARGE'],
    FILE_CHANGED: ['unreadable', 'SOURCE_CHANGED'],
    FILE_UNREADABLE: ['unreadable', 'SOURCE_UNREADABLE'],
    FILE_SYMLINK: ['forbidden', 'SOURCE_SYMLINK'],
    FILE_HARDLINKED: ['forbidden', 'SOURCE_HARDLINKED'],
    READ_BOUNDARY_INVALID: ['forbidden', 'SOURCE_BOUNDARY_INVALID'],
    READ_UNSUPPORTED_PLATFORM: ['forbidden', 'SOURCE_UNSUPPORTED_PLATFORM'],
};
/** Never maps a security violation to anything but 'forbidden'; no default for unknown codes. */
export function sourceFailure(code) {
    const [status, sourceCode] = FILE_CODE_MAP[code];
    return [isReadSecurityViolation(code) ? 'forbidden' : status, sourceCode];
}
