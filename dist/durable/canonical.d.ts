/**
 * Canonical JSON and hashing.
 *
 * Event hashes must be identical on every machine and every run, so objects
 * are serialized with sorted keys. Application data is validated to be plain
 * JSON up front: a value that would not survive a round trip (undefined in an
 * array, NaN, a Date, a class instance, a cycle) is rejected at the boundary
 * instead of being silently altered by `JSON.stringify` — a durable record
 * must read back exactly as it was written.
 */
export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
/**
 * Deep-copies `value` into plain JSON. Properties whose value is `undefined`
 * are dropped (the usual optional-field idiom); everything that is not
 * representable is a `ValidationError` naming the path, never the value.
 */
export declare function toJson(value: unknown, label?: string): Json;
/** Deterministic serialization: object keys sorted by UTF-16 code unit order. */
export declare function canonicalize(v: Json): string;
export declare function sha256Hex(data: string | Buffer): string;
/** Fingerprint of an observed value; equal values (any key order) give equal fingerprints. */
export declare function fingerprintOf(value: unknown): string;
//# sourceMappingURL=canonical.d.ts.map