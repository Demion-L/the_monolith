// Small shared list controls (UI-006): a case-insensitive text filter and a "Show more" window.
// Pure view state: no I/O, nothing is written back to any source. The Roadmap keeps its own,
// richer navigator (sliding window, phase jump); this covers the plain search + page case only.
import { computed, ref, watch, type Ref } from 'vue';

/** Same page size as the Roadmap navigator. */
export const LIST_PAGE_SIZE = 10;

/** Case-insensitive substring match over the given fields; `null` fields never match. Empty query matches all. */
export function matchesQuery(query: string, fields: ReadonlyArray<string | null | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(q));
}

/**
 * Filter + window over a list. Changing the query resets the window to the first page.
 * The list order is the caller's order; items are never copied, merged or de-duplicated here,
 * the window is a plain slice, so no item can appear twice.
 */
export function useSearchableList<T>(items: Ref<readonly T[]>, fields: (item: T) => ReadonlyArray<string | null | undefined>) {
  const query = ref('');
  const visibleCount = ref(LIST_PAGE_SIZE);
  const filtered = computed(() => items.value.filter((it) => matchesQuery(query.value, fields(it))));
  const visible = computed(() => filtered.value.slice(0, visibleCount.value));
  const remaining = computed(() => Math.max(0, filtered.value.length - visibleCount.value));
  watch(query, () => { visibleCount.value = LIST_PAGE_SIZE; });
  function showMore(): void { visibleCount.value += LIST_PAGE_SIZE; }
  function clear(): void { query.value = ''; }
  return { query, filtered, visible, remaining, showMore, clear };
}
