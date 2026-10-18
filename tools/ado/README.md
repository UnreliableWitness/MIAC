# Azure DevOps test-data seed

`seed-test-items.mjs` is a developer tool for the owner's test organisation, not app code. It creates three Issues, one Task and one child Task (under the first Issue, so the sprint page shows nesting) in the current sprint of a project, and skips any item whose title already exists, so it is safe to rerun. It reads the PAT from the macOS Keychain entry (account `shellie`, the given service) and never prints it. Unlike the app, which only reads, this script writes to Azure DevOps.

```
node tools/ado/seed-test-items.mjs <organizationUrl> <project> <keychain-service>
```
