import type { MenuItemConstructorOptions } from 'electron';

export type MenuPlan =
  | { kind: 'template'; template: MenuItemConstructorOptions[] }
  | { kind: 'none' }
  | { kind: 'default' };

/**
 * The application menu per platform.
 * macOS gets the default roles minus View > Actual Size, whose Cmd+0 belongs to the Usage tab shortcut.
 * Packaged Windows and Linux builds have no menu bar, so the task strip sits at the top of the window;
 * dev builds keep Electron's default menu (reload, dev tools).
 */
export function appMenu(
  platform: NodeJS.Platform,
  isPackaged: boolean,
): MenuPlan {
  if (platform !== 'darwin')
    return isPackaged ? { kind: 'none' } : { kind: 'default' };
  return {
    kind: 'template',
    template: [
      { role: 'appMenu' },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ],
  };
}
