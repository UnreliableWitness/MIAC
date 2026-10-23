import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { installMatchMedia, resetTestColorScheme } from './testColorScheme';
import { useWorkItemTypes } from './workItemTypes';

installMatchMedia();

// findBy* and waitFor give up after 1 s by default; the CI runners (Windows above all) cross that under load,
// which made ChangesTab and UsagePanel tests fail at random. A pass still returns as soon as its check holds.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  resetTestColorScheme();
  useWorkItemTypes.getState().reset();
});
