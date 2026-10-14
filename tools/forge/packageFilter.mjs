// Decides which project files go into the packaged app (Electron Packager `ignore`, inverted).
// The Forge Vite plugin keeps only /.vite by default, but node-pty is external to the main bundle, so
// main.cjs does require('node-pty') at runtime. Keep its runtime files: package.json, lib (the JS and
// the conpty worker) and the native binaries for the target only. Its one dependency, node-addon-api,
// is build-only. binding.gyp and the C++ sources stay out, so Forge's rebuild step leaves the N-API
// prebuilds alone.

const PTY = '/node_modules/node-pty';

/**
 * @param {string} file path relative to the project, starting with '/' and using '/' on every OS
 * @param {string} target `${platform}-${arch}` of the app being packaged
 * @returns {boolean} true to copy the file into the package
 */
export function keepInPackage(
  file,
  target = `${process.platform}-${process.arch}`,
) {
  if (!file) return true;
  if (file === '/.vite' || file.startsWith('/.vite/')) return true;
  if (file === '/node_modules' || file === PTY) return true;
  if (!file.startsWith(`${PTY}/`)) return false;
  const rest = file.slice(PTY.length + 1);
  if (rest === 'package.json' || rest === 'LICENSE') return true;
  if (rest === 'lib' || rest.startsWith('lib/'))
    return !rest.endsWith('.map') && !rest.endsWith('.test.js');
  if (rest.endsWith('.pdb')) return false;
  if (rest === 'prebuilds') return true;
  const prebuild = `prebuilds/${target}`;
  if (rest === prebuild || rest.startsWith(`${prebuild}/`)) return true;
  if (rest === 'build' || rest === 'build/Release') return true;
  if (rest.startsWith('build/Release/'))
    return !/^build\/Release\/(obj|obj\.target|\.deps)(\/|$)/.test(rest);
  return false;
}
