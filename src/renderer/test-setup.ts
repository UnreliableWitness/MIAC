import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { useWorkItemTypes } from './workItemTypes';

afterEach(() => {
  cleanup();
  useWorkItemTypes.getState().reset();
});
