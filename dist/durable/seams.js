/**
 * Test seams of the stores. INTERNAL: nothing here is exported from the package entry point (`index.ts`), and the public
 * constructors never read these fields from their options. A store takes its seams from a one-shot hand-over slot that
 * only `testing.ts` fills, immediately before it calls the constructor. The package `exports` map exposes `.` alone, so
 * `testing.ts` cannot be imported from outside the package. This is API hygiene, not a security boundary: code running
 * inside the process can reach anything the process can.
 */
const slot = { fs: null, memory: null };
export function handOver(kind, seams) {
    slot[kind] = seams;
}
export function takeFsSeams() {
    const s = slot.fs ?? {};
    slot.fs = null;
    return s;
}
export function takeMemorySeams() {
    const s = slot.memory ?? {};
    slot.memory = null;
    return s;
}
