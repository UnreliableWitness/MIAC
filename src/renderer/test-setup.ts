import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { installMatchMedia, resetTestColorScheme } from './testColorScheme';
import { useWorkItemTypes } from './workItemTypes';

installMatchMedia();

afterEach(() => {
  cleanup();
  resetTestColorScheme();
  useWorkItemTypes.getState().reset();
});
