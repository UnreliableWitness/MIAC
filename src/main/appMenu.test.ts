import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';
import { appMenu } from './appMenu';

function flatten(
  items: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] {
  return items.flatMap((i) => [
    i,
    ...(Array.isArray(i.submenu) ? flatten(i.submenu) : []),
  ]);
}

describe('appMenu', () => {
  it('gives macOS an explicit menu that leaves Cmd+0 to the renderer', () => {
    const plan = appMenu('darwin', true);
    expect(plan.kind).toBe('template');
    if (plan.kind !== 'template') return;
    const items = flatten(plan.template);
    expect(items.map((i) => i.role).filter(Boolean)).toEqual(
      expect.arrayContaining([
        'appMenu',
        'fileMenu',
        'editMenu',
        'windowMenu',
        'zoomIn',
        'zoomOut',
        'toggleDevTools',
      ]),
    );
    expect(items.find((i) => i.role === 'resetZoom')).toBeUndefined();
    for (const i of items)
      expect(String(i.accelerator ?? '')).not.toMatch(
        /^(CmdOrCtrl|CommandOrControl|Cmd|Command|Ctrl|Control)\+0$/,
      );
  });

  it('keeps the same menu in macOS dev builds', () => {
    expect(appMenu('darwin', false).kind).toBe('template');
  });

  it.each(['win32', 'linux'] as const)(
    'removes the menu bar from packaged %s builds and keeps the default in dev',
    (platform) => {
      expect(appMenu(platform, true)).toEqual({ kind: 'none' });
      expect(appMenu(platform, false)).toEqual({ kind: 'default' });
    },
  );
});
