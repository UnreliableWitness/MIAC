// Called by @electron/windows-sign for every file (hookModulePath). Signs with Azure Artifact Signing.
// Credentials come from the Azure CLI login done by the CI workflow (azure/login with OIDC). The dlib asks
// the CLI for a token on each call, but the CLI cannot refresh a token obtained through OIDC: it expires
// about 60-90 minutes after the login, so the build must finish signing inside that window.
const { execFileSync } = require('node:child_process');

module.exports = function sign(file) {
  const signtool = process.env.SIGNTOOL_PATH;
  const dlib = process.env.ARTIFACT_SIGNING_DLIB;
  const metadata = process.env.ARTIFACT_SIGNING_METADATA;
  if (!signtool || !dlib || !metadata)
    throw new Error(
      'Signing requested but SIGNTOOL_PATH, ARTIFACT_SIGNING_DLIB or ARTIFACT_SIGNING_METADATA is missing',
    );
  execFileSync(
    signtool,
    [
      'sign',
      '/v',
      '/fd',
      'SHA256',
      '/tr',
      'http://timestamp.acs.microsoft.com',
      '/td',
      'SHA256',
      '/dlib',
      dlib,
      '/dmdf',
      metadata,
      file,
    ],
    { stdio: 'inherit' },
  );
};
