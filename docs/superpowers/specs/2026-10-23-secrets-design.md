# Secrets: kept from agents, given to the tabs that need them, per environment

Date: 2026-10-23. Status: design, agreed in conversation with five mockups in `design/mockups/secrets/` (1 manager,
2 import from one `.env`, 3 a task with leak watch, 4 discovery with environment columns, 5 switching a task to
Production). Yellow labels on the mockups are notes, not UI. Screens 4 and 5 supersede 2 where they differ.

## Intent

Tasks today copy plaintext `.env` files into every worktree (`copy:` in `.shellie.yml`), where Claude Code, Copilot
and OpenCode can read them, and anything in a tab's environment can be printed with `printenv`. Similar tools either
deny file reads (a guardrail a shell command walks around) or keep secret references in files and inject values only
into the process that needs them. Shellie takes the second road and does it for the developer: it **finds** the secrets
a repo already has on this machine, **imports** them through a friendly screen, keeps them **encrypted per developer**,
and **gives them only to the tabs that need them** (Setup, the dev server, tests, the developer's own shell) — never to
agent tabs. A task can run against **Development, Test, UAT or Production**, chosen when it starts and changeable while
it runs, so a developer can investigate a UAT or Production issue from a task.

The owner asked for "a really nice manager screen". The manager is the centre of the feature, not an afterthought.

## Goals

1. **Settings › Secrets**: a full page (no overlays, #15) listing secrets per scope (one repo, or All repositories) with
   one column per environment, masked values with hold-to-reveal, where each is given, and when it changed. A green
   status panel says in one sentence what is protected and how; a warning card names repos that still copy plaintext
   env files into worktrees, with a button to move those values into Shellie.
2. **Discovery**, local only, in known places inside the repo plus .NET user secrets (see "Where Shellie looks"),
   mapping file and profile names to environments, with an "Unassigned" lane for what it cannot map.
3. **Import**: one row per key, one column per environment, the source of each value, conflicts with a pick, gaps
   visible, secret-looking values pre-ticked, plain settings left where they are. Never edits the developer's files
   unless they tick that option. **Re-discovery** offers only new or changed values.
4. **Injection**: values go into the environment of the tabs they are given to (Setup, dev server/run tabs, test runs,
   the user's shell tab), for the task's current environment. Agent tabs never get them. Worktrees stop getting the
   secret values in copied env files (the copy is rewritten without them).
5. **Environment per task**: New task picks it (default Development, or the repo's default); Start uses the default; a
   running task switches from the secrets chip in the task bar, restarting only the tabs that hold secrets. The task
   shows its environment in the breadcrumb, tab labels, Done page and the draft PR description.
6. **UAT and Production care**: a confirm before every switch naming the environment and the keys; a coloured band
   (amber UAT, red Production) while active; Production expires (default 60 minutes, and always at Finish) back to
   Development and stops the tabs that had it; Start from Sprint/Home never picks UAT or Production.
7. **Agent guardrails**: Claude Code tabs get `--settings` deny rules for reading the env files and secret files the
   discovery found (`Read`, plus `Bash(cat|type|Get-Content …)` on those paths); OpenCode gets its permission config.
8. **Leak watch**: Shellie scans agent tab output and the Changes diff for any stored value of the task's environment
   (exact match, plus base64), hides it on screen as `[NAME]`, and tells the developer plainly that the model has
   already seen it. A Production value pauses that agent tab (sends no input; shows a bar with Resume / Stop). A secret
   in the Changes diff blocks Finish's push for that repo until the developer confirms or removes it.
9. **`shellie run <name>` for agents** (decided 2026-10-23): agents keep running tests and the dev server, but through
   Shellie, which runs the named command with the task's secrets in a Shellie-owned process and streams back only the
   leak-filtered output and the exit code. Agents never hold the values in their own shell.
10. Telemetry only says what happened, never names, values, paths or environment names beyond the fixed four.

## Non-goals

- Fetching from Azure Key Vault, 1Password or other stores (a later "Fetch from a store" option).
- Sharing secrets between developers or machines; each developer imports their own.
- Encrypting or rewriting the developer's own main-checkout files (only on an explicit tick).
- Guaranteeing an agent cannot get a value the running app exposes; leak watch detects, it does not prevent.
- Secrets for the agent CLIs themselves (their API keys stay in their own config).

## Anti-goals

- A secret on disk in a worktree (outside files git tracks, see "Tracked files"), in Shellie's logs, in telemetry, in a crash report, or in the renderer's state longer
  than a reveal.
- A silent Production: any path that uses Production values without the confirm and the red band.
- Breaking a repo that has no secrets in Shellie: with nothing stored, tasks behave exactly as today.
- Making the manager a wall of masked text: sources, gaps and where-given must be readable at a glance.

## Constraints

- Electron + React + TypeScript, Vitest; Windows is the release target. Paths and shell commands behind `Platform`.
- Encryption with Electron `safeStorage`, as connection PATs are (`ConnectionStore`). Values decrypted in main only;
  the renderer receives masked forms, and a full value only for an explicit reveal (held), dropped on release.
- Terminal env is built in `src/main/ipc/handlers.ts` (`spawnTerminal`: `telemetryEnv` + `terminalEnv` + the command's
  env). Agent kinds are `claude`, `copilot`, `opencode`; the others are `shell` and `run` (Setup is a `run` tab with
  `setupCommands`).
- Copying env files happens in `SetupRunner` (`copy:` from `.shellie.yml`).
- Existing installs: nothing changes until the developer imports something.
- Telemetry events go into `docs/telemetry.md`.

## The design

### Data

- `secrets.json` in userData, version 1: `{ secrets: [{ id, scope: { repoId } | 'all', name, givenTo: ('setup' |
  'run' | 'tests' | 'shell')[], values: { development?, test?, uat?, production?: { ciphertext, source: string |
  null, changedAt } } }], repoDefaults: { [repoId]: { environment } } }`. `source` is a repo-relative path or
  "user secrets" / "launch profile <name>", for display only.
- Environment names are fixed: `development`, `test`, `uat`, `production` (displayed Development, Test, UAT,
  Production). The task stores `environment` and, while UAT/Production, `environmentUntil` (ISO) for Production expiry.
- A scope `all` secret applies to every repo unless that repo has a secret of the same name (repo wins).
- Name rules: environment-variable safe (`[A-Za-z_][A-Za-z0-9_]*` plus `__` for .NET nesting); case-sensitive.

### Where Shellie looks (discovery)

Inside the repo's main checkout, git-ignored or not, at the root and in project folders up to two levels down:
- `.env`, `.env.local`, `.env.<env>`, `.env.<env>.local`
- `appsettings.<Environment>.json` — `ConnectionStrings:*` and string values under keys whose name looks secret;
  flattened to `ConnectionStrings__Db` style names
- `Properties/launchSettings.json` — each profile's `environmentVariables`; the profile maps to an environment by its
  name or its `ASPNETCORE_ENVIRONMENT` / `DOTNET_ENVIRONMENT`
- .NET user secrets for any project with a `UserSecretsId` (`~/.microsoft/usersecrets/<id>/secrets.json` on macOS and
  Linux, `%APPDATA%\Microsoft\UserSecrets\<id>\secrets.json` on Windows) — Development
- `.vscode/launch.json` `env` / `envFile`
- `docker-compose*.yml` `environment:` and `env_file:`
- Azure Functions `local.settings.json` `Values` and `ConnectionStrings` — Development
- `secrets/` folders and `*.secrets.json` files (JSON or `KEY=VALUE`)

Never outside the repo except the user-secrets folder; never shell profiles. Discovery runs when a repo is added (a
quiet "N secrets found" notice, no import) and when the Secrets page opens for a repo; not in the background.

**Environment mapping:** `dev|development|local` → Development; `test|tst|qa` → Test; `uat|acc|acceptance|staging|
stg` → UAT; `prod|prd|production|live` → Production; otherwise Unassigned. Plain `.env` / `.env.local` →
Development.

**Looks like a secret:** name contains `KEY|SECRET|TOKEN|PASSWORD|PWD|CONNECTIONSTRING|CREDENTIAL|DSN`; or the value
matches a known format (`sk_live_`, `sk_test_`, `ghp_`, `npm_`, `xox[bp]-`, `AKIA…`, `-----BEGIN … PRIVATE KEY`, JWT,
Azure `AccountKey=`/`SharedAccessKey=`, URLs with `user:password@`). Others are plain settings, shown unticked.

### Manager (mockup 1, with screen 4's environment columns)

- Left: Scope list (All repositories, then each repo with a count) — no environment list; environments are columns.
- Status panel per repo: "protected" (green) when no `copy:` file holds a stored secret and guardrails are on;
  otherwise amber with the reason.
- Table: Name; one column per environment with the masked value (first 4–8 recognisable chars + `••••` + last 4 for
  known formats, else `••••`), its source below, an empty cell "add" for gaps; Given to (chips: Setup, Dev server,
  Tests, Your shell — "Agents" always struck through); Changed; ⋯ menu (Edit, Move to All repositories, Delete).
- Hold the eye to reveal one cell; release hides it; reveals are logged locally (time, name, environment) and never
  sent.
- Add secret: name, scope, given-to, a value per environment (any may be empty).
- Warning card for repos whose `copy:` files contain stored secrets: "Move N values into Shellie…" opens the import.

### Import (mockup 4)

- Header chips list every source found. Rows: tick, name, one column per environment (value masked, source), conflict
  cells with a radio per source, "not found" gaps, "same as Development?" link-up for Test when Test is missing.
- Unassigned lane: one card per value with environment buttons and Skip.
- Options: rewrite worktree copies without the imported keys (default on); remove them from the main checkout's
  files (default off; per-file, `.env` style only — never JSON or user secrets).
- Footer: count, "encrypted on this machine", and that Production asks before every use.
- Re-discovery compares by name+environment+value hash; only new or changed rows are shown, changed ones with the old
  source.

### Injection and the environment per task

- `spawnTerminal` adds `secretsEnv(task, def)` for `run` (Setup → `setup`; others → `run`, or `tests` when the command
  is the repo's test command), and `shell` (`shell`) tabs; never for agent kinds. Multi-repo tasks (#48): values come
  from the store of the tab's own workspace repo (`def.workspaceId`); the environment is the task's.
- **Tests**: no new tab kind or `.shellie.yml` key. The test command is a `run:` entry named `test` if present, else
  `npm test` when `package.json` has `scripts.test`, else `dotnet test` when a test project exists.
- **Default "given to"** on import: Setup, Dev server and Tests; Your shell off (one tick per secret later). Values for the task's environment
  only; a missing value is left unset (no empty string).
- SetupRunner's `copy:` writes env files with stored keys removed (line-level for `.env` style; JSON keys removed for
  JSON sources it copies).
- New task: an Environment select. Start: the repo default (Development unless set; never UAT/Production).
- Task bar chip "⛨ <Environment> ▾" (mockup 5) opens the environment menu with gaps shown ("3 of 5 values"); choosing
  UAT or Production shows the confirm (environment, tabs, key names), then restarts the secret-holding tabs and sets
  the band. Production sets `environmentUntil = now + productionMinutes` (setting, default 60); at expiry or Finish:
  stop those tabs, switch to Development, notify.
- The environment appears in the breadcrumb (coloured for UAT/Production), tab labels, the Done page and a line in the
  draft PR description ("Run against UAT").

### `shellie run` for agents (decided by the owner)

- Agent tabs get `shellie` on PATH (the existing CLI entry, `shellie start <workitem>`, gains `run`) and the task's
  run endpoint in their env (`SHELLIE_RUN_URL` + a per-task token, like the attention URL/token today).
  `shellie run <name> [-- args…]` calls main over that local endpoint; main runs the command in the task's worktree with
  the task environment's secrets, as a visible `run` tab labelled `agent · <name>`, and streams stdout/stderr back
  **after leak filtering** (stored values → `[NAME]`), then exits with the command's exit code.
- Only **named** commands: the repo's `run:` entries in `.shellie.yml`, plus `test` (see "Tests") and `setup`. No
  arbitrary command lines (`shellie run "printenv"` is refused with the list of names). Extra args after `--` are
  passed through as arguments, never through a shell (with `--` in front for an npm, pnpm or yarn script). They are
  refused, not escaped, where they would not stay arguments: when the command's last line ends in an operator or has
  a comment, and on Windows when an argument holds `& | < > ^ % ! "` or a line break (a `.cmd` target re-parses it).
- UAT and Production: each `shellie run` asks in Shellie (an approve bar on the task: command, environment) before it
  starts; Development and Test run straight away. The bar shows what will really run: the `run:` entry's full
  command, or for `npm test` / `npm run <x>` the worktree package.json's script text, the arguments quoted, and
  "Files in this worktree changed since the base can change what this runs."
- **Threat model.** `shellie run` and leak watch protect against accidental exposure: an agent printing a value,
  pasting it into a file or a commit. They do not stop an agent that sets out to leak: it can edit the tests, the
  package.json scripts or `.shellie.yml` so a named command prints a value in a form the matcher does not know.
  That is why UAT and Production approvals show the resolved script, not just the name. Pinning scripts to the base
  would close it but breaks the normal loop (agents run the tests they write).
- Claude Code tabs are told in the system prompt (`claudeContext`) that commands needing secrets run as
  `shellie run <name>` and which names exist; OpenCode gets the same line in its instructions file.
- Import shows the cost once: "Agents run tests and the dev server through `shellie run`; plain `npm test` in an agent
  tab runs without secrets."

### Tracked files (decided by the owner)

- Discovery imports values from git-tracked files too (appsettings, launchSettings, local.settings.json,
  docker-compose, `.vscode/launch.json`, `secrets/`), so tabs can override them per environment, but Shellie never
  edits tracked files.
- The repo's status panel is amber while any stored secret's value is still present in a tracked file: "Secrets are
  committed in N files — move them out of git", listing the files. Green only when none are.
- Deny rules for agents cover only untracked/ignored secret files; tracked config stays readable (agents need to edit
  it). Leak watch does not alert on reads of tracked files (the value is in git already); it alerts on a value showing
  up that is not in any tracked file.

### Framework environment (my call)

- Injection also sets the framework's environment name for the task environment: `ASPNETCORE_ENVIRONMENT` and
  `DOTNET_ENVIRONMENT` (Development, Test, Uat, Production — per-repo overridable spelling) and `NODE_ENV` only for
  Development (`development`) and Production (`production`).
- For `dotnet run` commands Shellie adds `--launch-profile <name>` when a launch profile maps to the task environment;
  when a launch profile would override a stored key with another value, the switch confirm lists it ("launchSettings
  sets ConnectionStrings__Db; the profile's value wins") so a red band never sits on top of Development values silently.

### Guardrails for agents

- Claude Code: the existing `--settings` file per tab (see `claudeTheme.ts`) gains `permissions.deny` entries for the
  discovered secret file paths (relative to the worktree) — `Read(path)` and `Bash(cat path)`, `Bash(type path)`,
  `Bash(Get-Content path)`. OpenCode: its config gets matching deny rules. Copilot: none available; documented.

### Leak watch

- Main keeps a matcher of the task environment's values (and their base64) in memory only. Agent tab output is
  scanned before it reaches the renderer; matches are replaced with `[NAME]` in the rendered stream and a notice is
  raised once per name per session. The Changes diff and Finish's pre-push check scan added lines.
- Production match in an agent tab: Shellie pauses the tab (stops forwarding renderer input, shows a bar "A Production
  secret appeared — Resume / Stop"); the model has seen it; the bar says to rotate.
- Values shorter than 8 characters are not matched (noise).
- The Changes diff and Finish's pre-push scan check the values of **every** environment (a Production value committed
  while the task is on Development is still caught); agent output is matched against every environment too.
- Multi-repo tasks: the matcher holds the union of the task's repos' values.

### Existing worktrees

- After an import, open and reopened tasks of that repo keep their old plaintext copies until cleaned: the Secrets
  page and the task bar offer "Clean N worktrees", which rewrites their copied env files without the imported keys and
  restarts the secret-holding tabs. The status panel stays amber until every open task is clean.

### Telemetry

`secrets.discovered` (counts per source kind), `secrets.imported` (count, environments as the fixed four names),
`secrets.environmentSwitched` (from/to fixed names, confirmed), `secrets.productionExpired`, `secrets.leakDetected`
(where: agent | diff; environment fixed name). Never names, values, paths or sources.

## What's left to the builder

Exact copy beyond the mockups; the matcher's implementation (Aho–Corasick or simple scan); how the paused agent tab
stops input; JSON flattening details for appsettings; test fixtures for each discovery source; Windows PowerShell deny
patterns beyond the three named.

## Calls I made (for the owner to check)

- Agents run secret-needing commands only by name through `shellie run`; UAT and Production runs need an approve in
  Shellie.
- Shellie sets `ASPNETCORE_ENVIRONMENT`/`DOTNET_ENVIRONMENT`/`NODE_ENV` and picks a matching launch profile; overrides
  by a profile are listed in the confirm.
- Imported secrets go to Setup, Dev server and Tests by default; your own shell is opt-in per secret.
- "Tests" means a `run:` entry named `test`, else `npm test`, else `dotnet test`; no new tab kind.
- Multi-repo tasks take each tab's values from its own repo; one environment per task.
- Pre-push and leak scans check every environment's values, not only the current one.
- Existing worktrees are cleaned on request ("Clean N worktrees"), not silently.

- Environments are a fixed four, not user-defined.
- Your own shell tab can receive secrets (you choose per secret); agent tabs never.
- Production auto-expires after 60 minutes (setting) and always at Finish.
- Leak watch hides on screen and warns; it pauses only for Production; it never claims to have undone anything.
- Discovery runs on add (notice only) and when Secrets opens, not in the background.
- Importing never changes the developer's own files unless ticked, and never JSON or user-secrets files.
- Only the four Claude/OpenCode deny rule shapes; Copilot has no equivalent.
