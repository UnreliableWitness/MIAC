import { promises as fs } from 'node:fs';
import path from 'node:path';

/** A temp file's name never looks like an env file, so one left by a crash is not picked up later. */
const TEMP_PREFIX = '.shellie-tmp-';

/** Writes next to the file and renames over it, so a crash never leaves half a file; the mode stays. */
export async function replaceFile(abs: string, text: string): Promise<void> {
  const mode = (await fs.stat(abs)).mode & 0o777;
  const tmp = path.join(
    path.dirname(abs),
    `${TEMP_PREFIX}${process.pid}-${path.basename(abs)}`,
  );
  try {
    await fs.writeFile(tmp, text, { encoding: 'utf8', mode });
    await fs.chmod(tmp, mode);
    await fs.rename(tmp, abs);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}
