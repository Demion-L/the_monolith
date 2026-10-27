import type { VueWrapper } from '@vue/test-utils';
import { SECTIONS } from '../sections';

// Only one section is mounted at a time, so tests move between sections explicitly.
export async function goTo(w: VueWrapper, id: string): Promise<void> {
  await w.get(`.nav a[href="#${id}"]`).trigger('click');
}

// Visits every section in turn and returns what `read` saw in each.
export async function sweep<T>(w: VueWrapper, read: () => T): Promise<T[]> {
  const out: T[] = [];
  for (const { id } of SECTIONS) {
    await goTo(w, id);
    out.push(read());
  }
  return out;
}
