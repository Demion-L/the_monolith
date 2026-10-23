import { configDefaults, defineConfig } from 'vitest/config';

// The Vue dashboard (ui/) has its own config and test script (test:ui);
// keep it out of the Core `vitest run`.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, 'ui/**'] },
});
