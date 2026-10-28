import { compareObjects, makeRef, parseRef } from './identity.js';
export function buildObjectIndex(objects, loadedNamespaces) {
    const byRef = new Map();
    for (const obj of objects) {
        const list = byRef.get(obj.ref);
        if (list)
            list.push(obj);
        else
            byRef.set(obj.ref, [obj]);
    }
    for (const list of byRef.values())
        list.sort(compareObjects);
    return { byRef, loadedNamespaces: new Set(loadedNamespaces) };
}
/**
 * @param raw             reference text as written in the source artifact
 * @param sourceNamespace namespace of the artifact containing the reference
 */
export function resolveRef(raw, sourceNamespace, index) {
    const parsed = parseRef(raw);
    if (!parsed.ok)
        return { status: 'INVALID_REF', raw, reason: parsed.reason };
    // Rule 2: an unqualified id is looked up only inside the source's own namespace.
    const namespace = parsed.qualified ? parsed.namespace : sourceNamespace;
    const ref = makeRef(namespace, parsed.localId);
    // Rule 5: a namespace with no loaded corpus is unavailable, not a missing local object.
    if (!index.loadedNamespaces.has(namespace)) {
        return { status: 'EXTERNAL_UNAVAILABLE', ref, namespace };
    }
    const candidates = index.byRef.get(ref);
    if (!candidates || candidates.length === 0)
        return { status: 'MISSING', ref };
    if (candidates.length > 1)
        return { status: 'AMBIGUOUS', ref, candidates: [...candidates] };
    return { status: 'RESOLVED', ref, object: candidates[0] };
}
