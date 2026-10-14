import { darwinPlatform } from './darwin';
import type { Platform } from './Platform';
import { which } from './which';
import { windowsPlatform } from './windows';

export type { Command, Platform } from './Platform';
export { windowsPlatform, which };

export function createPlatform(env: NodeJS.ProcessEnv = process.env): Platform {
  if (process.platform === 'win32') {
    return windowsPlatform(env, { which: (n) => which(n, env) });
  }
  return darwinPlatform(env);
}
