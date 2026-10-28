/**
 * Canonical Knowledge Identity.
 *
 * ref = namespace:localId. Neither part is derived from a title, a path or a slug:
 * namespace is supplied by the caller, localId is declared in the artifact
 * (frontmatter `id:` or a `{#ID}` heading marker). Identifiers are case-sensitive.
 */

export type KnowledgeObjectKind = 'document' | 'section';

export interface KnowledgeObject {
  ref: string;
  namespace: string;
  localId: string;
  kind: KnowledgeObjectKind;
  title?: string;
  status?: string;
  location: {
    artifactId: string;
    path: string;
    line?: number;
  };
}

/** Allowed in both namespace and localId. Excludes ':' (the ref separator), whitespace and braces. */
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isValidIdentifier(value: string): boolean {
  return IDENTIFIER_RE.test(value);
}

export function makeRef(namespace: string, localId: string): string {
  return `${namespace}:${localId}`;
}

export type ParsedRef =
  | { ok: true; qualified: boolean; namespace?: string; localId: string }
  | { ok: false; reason: string };

/** Syntactic parse only; whether the ref resolves is the resolver's concern. */
export function parseRef(raw: string): ParsedRef {
  const value = raw.trim();
  if (value === '') return { ok: false, reason: 'empty reference' };

  const parts = value.split(':');
  if (parts.length > 2) return { ok: false, reason: 'more than one ":" separator' };

  if (parts.length === 2) {
    const [namespace, localId] = parts;
    if (!isValidIdentifier(namespace)) return { ok: false, reason: `invalid namespace "${namespace}"` };
    if (!isValidIdentifier(localId)) return { ok: false, reason: `invalid local id "${localId}"` };
    return { ok: true, qualified: true, namespace, localId };
  }

  if (!isValidIdentifier(value)) return { ok: false, reason: `invalid local id "${value}"` };
  return { ok: true, qualified: false, localId: value };
}

/** Total order used for every candidate list, so output never depends on input order. */
export function compareObjects(a: KnowledgeObject, b: KnowledgeObject): number {
  return (
    cmp(a.ref, b.ref) ||
    cmp(a.location.artifactId, b.location.artifactId) ||
    cmp(a.location.path, b.location.path) ||
    (a.location.line ?? -1) - (b.location.line ?? -1) ||
    cmp(a.kind, b.kind)
  );
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
