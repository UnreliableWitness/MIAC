// node-pty ships prebuilt spawn-helper binaries without the execute bit on
// some installs, which makes terminals fail with "posix_spawnp failed".
import fs from 'node:fs';
import path from 'node:path';

const root = path.join('node_modules', 'node-pty', 'prebuilds');

if (fs.existsSync(root)) {
  for (const dir of fs.readdirSync(root)) {
    const helper = path.join(root, dir, 'spawn-helper');
    try {
      if (fs.statSync(helper).isFile()) fs.chmodSync(helper, 0o755);
    } catch {
      // No spawn-helper for this platform folder; nothing to fix.
    }
  }
}
