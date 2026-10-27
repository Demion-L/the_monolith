// The dashboard sections, in navigation order. Ids match the `id` of each panel's <section>.
export const SECTIONS = [
  { id: 'overview', label: 'Project Overview' },
  { id: 'mission', label: 'Current Mission' },
  { id: 'checkpoints', label: 'Checkpoints' },
  { id: 'roadmap', label: 'Roadmap' },
  { id: 'diagnostics', label: 'Diagnostics' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

export const DEFAULT_SECTION: SectionId = SECTIONS[0].id;

export function isSectionId(value: unknown): value is SectionId {
  return SECTIONS.some((s) => s.id === value);
}

// Unknown or empty hashes fall back to the default section.
export function sectionFromHash(hash: string): SectionId {
  const id = hash.replace(/^#/, '');
  return isSectionId(id) ? id : DEFAULT_SECTION;
}
