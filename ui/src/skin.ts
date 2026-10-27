export const SKINS = ['classic', 'cosmic-glass'] as const;
export type SkinId = (typeof SKINS)[number];

export const DEFAULT_SKIN: SkinId = 'classic';
export const SKIN_STORAGE_KEY = 'monolith.skin';

export function isSkinId(value: unknown): value is SkinId {
  return typeof value === 'string' && (SKINS as readonly string[]).includes(value);
}

// Storage may be missing, blocked or throwing; every failure degrades to Classic.
export function readSavedSkin(): SkinId {
  try {
    const saved = window.localStorage.getItem(SKIN_STORAGE_KEY);
    return isSkinId(saved) ? saved : DEFAULT_SKIN;
  } catch {
    return DEFAULT_SKIN;
  }
}

export function applySkin(skin: SkinId): void {
  document.documentElement.dataset.skin = skin;
}

export function saveSkin(skin: SkinId): void {
  try {
    window.localStorage.setItem(SKIN_STORAGE_KEY, skin);
  } catch {
    // The choice still applies for this session.
  }
}

export function setSkin(skin: SkinId): void {
  applySkin(skin);
  saveSkin(skin);
}

// Called before the app mounts so the first paint already uses the saved skin.
export function initSkin(): SkinId {
  const skin = readSavedSkin();
  applySkin(skin);
  return skin;
}

export function currentSkin(): SkinId {
  const applied = document.documentElement.dataset.skin;
  return isSkinId(applied) ? applied : DEFAULT_SKIN;
}
