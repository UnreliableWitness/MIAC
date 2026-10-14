# Windows signing hook

`sign.cjs` is the `hookModulePath` module that `@electron/windows-sign` calls for every file
Electron Forge signs (the packaged exe, and the Squirrel installer). It runs `signtool.exe` with the
Azure Artifact Signing dlib, SHA256, and the timestamp server `http://timestamp.acs.microsoft.com`.

It only runs in CI. `forge.config.mts` enables it when `ARTIFACT_SIGNING_ENDPOINT` is set, and the
workflow in `.github/workflows/ci.yml` sets that only in the `windows-release` job (push to `main` or a
`v*` tag, GitHub environment `release`), and only when all six Azure variables exist. Never on pull requests.

Environment variables the hook reads (all set by the workflow):

- `SIGNTOOL_PATH`: full path to the Windows SDK x64 `signtool.exe`.
- `ARTIFACT_SIGNING_DLIB`: full path to `Azure.CodeSigning.Dlib.dll`.
- `ARTIFACT_SIGNING_METADATA`: path to the `metadata.json` the workflow writes (endpoint, account, profile).

If one is missing the hook throws, so the build fails instead of producing an unsigned installer.

The Azure setup the owner has to do (identity validation, signing account, certificate profile,
OIDC app registration, GitHub variables) is in the "Owner setup for signing" section of
`docs/superpowers/specs/2026-10-14-windows-support-design.md`.
