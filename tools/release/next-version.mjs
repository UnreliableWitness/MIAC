// The version a push to main releases: the highest vX.Y.Z tag with minor + 1 and patch 0 (v1.0.2 -> v1.1.0).
// Run from CI on main: reads the remote's tags with git and prints the version.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * @param {string} lsRemote lines of "<sha>\trefs/tags/vX.Y.Z", including annotated "^{}" lines and other tags
 * @returns {string} the next minor version, without the "v"
 */
export function nextMinorVersion(lsRemote) {
  let best = null;
  for (const m of lsRemote.matchAll(
    /refs\/tags\/v(\d+)\.(\d+)\.(\d+)(?:\^\{\})?\s*$/gm,
  )) {
    const v = m.slice(1, 4).map(Number);
    if (
      !best ||
      v[0] > best[0] ||
      (v[0] === best[0] &&
        (v[1] > best[1] || (v[1] === best[1] && v[2] > best[2])))
    )
      best = v;
  }
  if (!best) return '1.0.0';
  return `${best[0]}.${best[1] + 1}.0`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  console.log(
    nextMinorVersion(
      execFileSync('git', ['ls-remote', '--tags', 'origin', 'refs/tags/v*'], {
        encoding: 'utf8',
      }),
    ),
  );
