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

import { createHash } from 'crypto';
import { ValidationError } from './errors.js';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const MAX_DEPTH = 64;

/**
 * Deep-copies `value` into plain JSON. Properties whose value is `undefined`
 * are dropped (the usual optional-field idiom); everything that is not
 * representable is a `ValidationError` naming the path, never the value.
 */
export function toJson(value: unknown, label = 'value'): Json {
  return walk(value, label, 0);
}

function walk(v: unknown, path: string, depth: number): Json {
  if (depth > MAX_DEPTH) throw new ValidationError(`${path}: nesting deeper than ${MAX_DEPTH}.`);
  if (v === null) return null;
  switch (typeof v) {
    case 'boolean':
    case 'string':
      return v;
    case 'number':
      if (!Number.isFinite(v)) throw new ValidationError(`${path}: non-finite number.`);
      if (Object.is(v, -0)) return 0;
      return v;
    case 'object':
      break;
    default:
      throw new ValidationError(`${path}: ${typeof v} is not JSON.`);
  }
  if (Array.isArray(v)) {
    return v.map((item, i) => {
      if (item === undefined) throw new ValidationError(`${path}[${i}]: undefined in an array.`);
      return walk(item, `${path}[${i}]`, depth + 1);
    });
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) throw new ValidationError(`${path}: only plain objects are allowed.`);
  const out: { [key: string]: Json } = {};
  for (const key of Object.keys(v as object)) {
    const item = (v as Record<string, unknown>)[key];
    if (item === undefined) continue;
    if (key === '__proto__') throw new ValidationError(`${path}: key "__proto__" is not allowed.`);
    out[key] = walk(item, `${path}.${key}`, depth + 1);
  }
  return out;
}

/** Deterministic serialization: object keys sorted by UTF-16 code unit order. */
export function canonicalize(v: Json): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(v[k] as Json)}`).join(',')}}`;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Fingerprint of an observed value; equal values (any key order) give equal fingerprints. */
export function fingerprintOf(value: unknown): string {
  return sha256Hex(canonicalize(toJson(value, 'observation')));
}
