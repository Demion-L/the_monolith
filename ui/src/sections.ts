// The dashboard sections, in navigation order. Ids match the `id` of each panel's <section>.
export const SECTIONS = [
  { id: 'overview', label: 'Project Overview' },
  { id: 'history', label: 'Development History' },
  { id: 'roadmap', label: 'Roadmap' },
  { id: 'graph', label: 'Execution Graph' },
  { id: 'knowledge', label: 'Knowledge Lab' },
  { id: 'decisions', label: 'Architecture Decisions' },
  { id: 'diagnostics', label: 'Diagnostics' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

export const DEFAULT_SECTION: SectionId = SECTIONS[0].id;

export function isSectionId(value: unknown): value is SectionId {
  return SECTIONS.some((s) => s.id === value);
}

// Hash links of earlier releases keep working: `#checkpoints` is now Development History.
const LEGACY_HASHES: Readonly<Record<string, SectionId>> = { checkpoints: 'history', hypotheses: 'knowledge' };

// Unknown or empty hashes fall back to the default section.
export function sectionFromHash(hash: string): SectionId {
  const id = hash.replace(/^#/, '');
  if (isSectionId(id)) return id;
  return Object.prototype.hasOwnProperty.call(LEGACY_HASHES, id) ? LEGACY_HASHES[id] : DEFAULT_SECTION;
}

// True for a hash that is a valid link (current or legacy); anything else is replaced by the default.
export function isKnownHash(id: string): boolean {
  return isSectionId(id) || Object.prototype.hasOwnProperty.call(LEGACY_HASHES, id);
}
