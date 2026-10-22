# App telemetry

Shellie sends anonymous usage, error and performance data to Azure Application Insights (resource `shellie-app`, resource group `shellie-telemetry`) so we can see which features are used, what breaks, and what is slow.

This is separate from the AI usage capture (the OTLP receiver on 127.0.0.1:4319 that prices Claude Code and Copilot usage). App telemetry uses its own small client (`src/main/telemetry/AppInsightsClient.ts`) that posts JSON to the App Insights ingestion endpoint; it does not use OpenTelemetry.

## Turning it off

- Settings > Appearance > **Send anonymous usage and error data** (on by default). Turning it off takes effect at once: queued items are dropped and nothing more is sent.
- Environment variable `SHELLIE_TELEMETRY=0` disables it for a launch.
- Builds without the `APPINSIGHTS_CONNECTION_STRING` environment variable at build time (all local builds, `npm start`) send nothing. CI injects it from the repo variable of the same name.

## Sent with every item

| Field | Example |
| --- | --- |
| App version | `1.0.0` |
| OS and OS version | `win32`, `10.0.26100` |
| CPU architecture | `x64` |
| Electron version | `44.7.2` |
| Packaged build | `true` |
| Install id | random UUID created on first launch, stored in `<userData>/telemetry-id` |
| Session id | random UUID per launch |

## Usage events

| Name | Properties / measurements |
| --- | --- |
| Screen views (page views) | `sprint`, `task`, `new-task`, `setup`, `finish`, `settings`, `home` |
| `app.started` | splash on/off; counts of repos, open tasks, connections; whether the usage receiver listens; boot step timings (see Performance) |
| `app.quit` | session length in minutes |
| `home.refreshed` | the Home page's data was rebuilt; number of connections, number that failed; duration in ms |
| `home.failed` | a connection failed in a Home rebuild; `kind` (`unauthorized`, `unreachable`, `timeout`, `step`) |
| `home.clicked` | a click on Home; `band` (`task`, `up-next`, `review`, `team-review`, `my-pr`, `sprint`, `stats-period`, `budget-month`, `budget-settings`) |
| `budget.alert` | a Claude budget alert fired (main); `kind` (`at80`, `forecastOver`, `at100`) |
| `update.ready` | an update finished downloading (Windows); none |
| `update.restart`, `update.later` | the choice on the update notice; none |
| `task.created` | has a work item; copy files, start Claude, open shell, open Copilot, open OpenCode (booleans); number of setup commands |
| `task.finished` | remove worktree, delete branch, close terminals, sync usage, has a work item (booleans); task age in hours, number of workspaces finished, pull requests asked for and workspaces dropped |
| `workitem.startUpdated` | setup moved the work item to In Progress (`moved`), assigned it (`assigned`), or the update failed (`failed`) |
| `pr.created` | Finish created a draft pull request; none |
| `pr.linked` | Finish linked an existing active pull request instead of creating one; none |
| `pr.failed` | Finish stopped because the push or pull request failed; `kind` (`git`, or the Azure DevOps error kind: `unauthorized`, `not-found`, `unreachable`, `http`) |
| `setup.finished` | ok; retry; kind of the failed step (`fetch`, `worktree`, `copy`, `task-file`, `command`, `terminals`); duration; step count |
| `setup.retried`, `setup.cancelled` | none |
| `task.reopened` | where the branch came from (`folder`: worktree kept, `branch`, `origin`, `commit`, `base`) |
| `task.reopenCancelled` | none |
| `migration.miac` | first start after the rename from MIAC copied its data folder, or gave up after the third failed attempt; `result` (`ok`, `failed`); `tokens` (`migrated`, `partial`, `refused`, `none`; `none` when the copy gave up); `copied` (number of top-level entries), `ms` |
| `workspace.joined` | a worktree of another repo joined a task; `source` (`log`: found in a Claude session log, `branch`: found by the task branch, `manual`: added by hand) |
| `workspace.removed` | a joined worktree was removed from its task; none |
| `terminal.opened` | kind (`claude`, `copilot`, `opencode`, `shell`, `run`); opened by setup or by hand |
| `terminal.closed` | kind |
| `terminal.restarted` | kind; after an app relaunch or not (a Claude Code restart resumes its session) |
| `usage.opened` | via the tab or the task strip |
| `usage.synced` | ok; on finish or by hand |
| `time.booked` | Finish booked time; `closest`: the measure the booked time is closest to (`measured`, `realistic`, `wallClock`), or `custom` when it is more than 5 minutes from all of them |
| `docs.opened` | view (`rendered`, `source`); from (`list`, `link`, `terminal`); the file opened automatically with the tab is not tracked |
| `docs.sessionView` | mode chosen in the Docs file list (`session`: the task's session docs, `all`: every doc in the worktree) |
| `docs.sentTo` | kind of the target terminal (`claude`, `copilot`, `shell`, `run`) |
| `terminal.linkOpened` | type of the clicked terminal link (`md`, `html`, `file`, `url`) |
| `editor.opened` | `editor` (`vscode`, `visualstudio`); `at` (`folder`, or `file` when opened at a line from Changes, Docs or a terminal link) |
| `review.opened` | scope (`all`, `uncommitted`, `commits`); number of files; number of repos |
| `review.fileViewed` | none |
| `review.commentsSent` | number of comments sent |
| `review.commentResolved` | `outdated`: whether the comment was outdated when resolved |
| `review.repoFiltered` | `via`: how the Changes tab was narrowed to one repo or back to all (`chip`, `key`, `breadcrumb`, `commit`, `comment`) |
| `review.repoCollapsed` | `how`: a repo group folded by hand (`manual`) or by itself once every file was viewed (`auto`) |
| `review.fileDiscarded` | `scope`: the Changes scope the file's changes were discarded or the new file deleted in (`all`, `uncommitted`) |
| `usage.exportCsv` | none |
| `focus.toggled`, `nav.toggled` | on / collapsed |
| `settings.changed` | names of the changed settings (not their values) |
| `workItems.search` | picker scope (`sprint` or `mine`); whether search text was typed (not the text) |
| `repo.added`, `repo.removed`, `repo.connectionLinked`, `connection.saved`, `connection.removed` | counts or linked/unlinked only |

## Errors

- Uncaught exceptions in the main process (monitored only: Electron's own handling is unchanged) and unhandled promise rejections.
- Renderer `window.onerror` and `unhandledrejection`.
- A failed boot (the splash or the "Shellie could not start" dialog).
- Every IPC call that fails (error type, message, stack and the channel name such as `tasks:create`; never the arguments).
- An unexpected setup failure.
- Every warning or error notice shown in the app (`notice` event: level and message).
- `process.gone`: a renderer or child process (GPU, utility) that crashed or was killed, with the reason and exit code.

## Performance

- `app.started` measurements: settings load, telemetry init, task/connection load, usage store load, IPC setup, usage receiver start, main window load (`windowMs`), boot to window ready (`readyMs`, also sent as metric `app.startup.readyMs`) and process start to window shown (`visibleMs`, includes the splash).
- Metric `setup.step.<kind>` per setup step in ms (`setup.step.worktree` is worktree creation), with the step status.
- `setup.finished` duration.
- Azure DevOps requests as dependencies: method and API route with ids and project names replaced (`GET _apis/wit/workitems/{id}`), host (`dev.azure.com` or `visualstudio.com`), duration, status code, success.

## Never sent

Work item titles or ids, repo names or paths, branch names, task names, Azure DevOps organization or project names, user names or e-mail addresses, PATs, terminal content, file contents, AI usage records.

Before anything is sent, main scrubs every message, stack trace and string property: the home folder and any other user folder become `~`, the names and paths of your repos, tasks, branches, work item titles, connection organizations, projects and users become `<redacted>`, URLs become `<url>` and e-mail addresses `<email>`. Messages are capped at 1000 characters, properties at 200.

## Delivery

Items are queued in memory (at most 500; the count of dropped items is reported as metric `telemetry.dropped`) and posted in batches of up to 100 to `<IngestionEndpoint>/v2/track` 15 seconds after the first queued item, when a batch is full, and on quit (the quit waits at most 2 seconds). A failed send is dropped, never retried and never shown to the user.
