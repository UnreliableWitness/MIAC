import { darwinPlatform } from './darwin';
import type { Platform } from './Platform';

export type { Command, Platform } from './Platform';

export function createPlatform(env: NodeJS.ProcessEnv = process.env): Platform {
  if (process.platform === 'win32') {
    throw new Error(
      'MIAC: the Windows platform module is not implemented yet (sub-project 1 is macOS-first).',
    );
  }
  return darwinPlatform(env);
}
