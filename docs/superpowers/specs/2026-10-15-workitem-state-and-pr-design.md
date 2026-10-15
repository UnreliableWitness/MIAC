# Work item state on start, draft pull request on Finish

Date: 2026-10-15. Owner decisions:
- Repos live in **Azure Repos**, in the same org as the work items.
- On start, the work item moves to In Progress.
- On Finish, the **state is left alone**.
- The pull request is a **draft**, created by MIAC and then opened in Azure DevOps so the developer adds reviewers and publishes it.
- Approach: Azure DevOps REST through the existing `AdoClient`. The PAT needs **Code (Read & write)** on top of Work Items (Read & write).

## Goal

Close the loop between MIAC and Azure DevOps:
- Starting a task shows as progress on the work item.
- Finishing a task leaves a draft pull request that is linked to the work item and carries the commits and the AI cost.
- The developer never has to go to Azure DevOps to start work or open the pull request.

## 1. Start: move the work item to In Progress

**When:** a new setup step, `work-item` ("Update work item"), runs after the `worktree` step. It only runs for tasks with a work item, on a repo with a connection, and when the repo setting is on.

**Logic**, in main, as a pure planner plus `AdoClient` calls:
1. Read the work item's `System.State`, `System.WorkItemType` and `System.AssignedTo` (one GET).
2. Read the type's states with their categories, using the existing `workitemtypes/{type}/states` call. The categories are `Proposed`, `InProgress`, `Resolved`, `Completed` and `Removed`.
3. Work out the target state:
   - if the repo setting has an override for this type, use it, but only if that state exists for the type;
   - otherwise use the first state in category `InProgress`, in API order.
4. Plan the patch:
   - **state:** only when the current state's category is `Proposed`. Never move an item backwards, or out of Resolved or Completed;
   - **assignee:** only when `System.AssignedTo` is empty and "assign to me" is on. The value is the PAT user's unique name, `authenticatedUser.properties.Account.$value` from `connectionData`, read in `verify` and stored on the connection as `userUniqueName` (nullable; filled on the next verify).
5. If the plan is empty, the step finishes as done with detail "Already in progress". Otherwise send one `PATCH _apis/wit/workitems/{id}` with a JSON Patch body: `add /fields/System.State` and/or `add /fields/System.AssignedTo`. The detail reads, for example, "New → In Progress, assigned to you".

**Failure:** the step ends as **warning**, never failed:
- a new step status `warn`, shown amber in the StepList;
- the setup still completes and the task becomes ready;
- the detail carries a short reason. For HTTP 401 or 403: "The token cannot update work items (needs Work Items: Read & write)". For HTTP 400 from a process rule: the rule message from Azure DevOps.

**Setting**, per repo, in `RepoSchema` with defaults so old state loads:
```ts
workItemOnStart: z.object({
  moveToInProgress: z.boolean().default(true),
  assignToMe: z.boolean().default(true),
  /** Work item type -> state name. Empty means "first In Progress state". */
  stateOverrides: z.record(z.string(), z.string()).default({}),
}).default({ moveToInProgress: true, assignToMe: true, stateOverrides: {} }),
```
The Settings repo row gets two checkboxes, "Move the work item to In Progress on start" and "Assign it to me if unassigned". An "Override per type" disclosure lists the connection's work item types, each with a select of its InProgress-category states plus "Default".

## 2. Finish: draft pull request

**Availability.** MIAC parses the repo's `origin` URL into `{ org, project, repo }`. Accepted forms:
- `https://dev.azure.com/{org}/{project}/_git/{repo}`, with or without `user@` in front;
- `https://{org}.visualstudio.com[/DefaultCollection]/{project}/_git/{repo}`;
- `git@ssh.dev.azure.com:v3/{org}/{project}/{repo}`;
- `{org}@vs-ssh.visualstudio.com:v3/{org}/{project}/{repo}`.

Segments are URL-decoded. The pull request option is **available** when:
- the parse succeeds;
- `{org}` matches the connection's organization;
- the task has a work item, or is a blank task (a blank task gets a PR with no link).

When it is unavailable, the reason shows next to the disabled checkbox:
- "origin is not an Azure Repos URL"
- "origin is in another Azure DevOps organization"
- "this repo has no Azure DevOps connection"

The PR may target a different project than the connection's, as long as the org is the same.

**Finish page.** Above the existing cleanup checkboxes there is a new checkbox, "Create a draft pull request into `<base>`". It is unticked on first use, then defaults to the last choice for that repo (kept in renderer localStorage, saved when Finish is clicked). This was the owner's decision on 2026-10-15, because power users may not want a PR every time. While a task is finishing, the existing checks still show. Uncommitted changes keep blocking as today. Unpushed commits are no longer a warning when the PR option is on, because MIAC pushes them.

**Finish sequence** when the PR option is on. Each step shows in the Finish progress:
1. **Push:** `git push -u origin <branch>`. On a non-fast-forward error, show git's message. MIAC never force-pushes.
2. **Find or create the pull request:**
   - Resolve the repository id with `GET {project}/_apis/git/repositories/{repo}`.
   - Look for an active PR from this branch: `GET .../pullrequests?searchCriteria.sourceRefName=refs/heads/<branch>&searchCriteria.status=active`. If one exists, use it as is: no second PR, and no changes to its title, description or links.
   - Otherwise create one: `POST .../pullrequests?api-version=7.1` with
     - `sourceRefName`: `refs/heads/<branch>`;
     - `targetRefName`: `refs/heads/<base>`, where the base is the task's `baseRef` without its remote prefix (`origin/main` → `main`);
     - `isDraft: true`;
     - `title`: "<id> <work item title>", or the task name for a blank task;
     - `workItemRefs`: `[{ id }]`;
     - `description`: see below.
3. **Record:** `task.pullRequest = { id, url, repositoryId, project, status: 'active', isDraft: true }`. The web URL is `{orgUrl}/{project}/_git/{repo}/pullrequest/{id}`.
4. **Open** the PR in the browser with `shell:openExternal`.
5. The **existing cleanup** runs: usage write-back, close terminals, remove the worktree, delete the local branch. The remote branch is untouched.

**Description**, in markdown, at most 4000 characters (the Azure DevOps limit). When it is too long, drop commits from the end and add "…and N more commits".
```
<work item type> <id>: <title>

## Commits
- <short sha> <subject>
…

AI cost for this task: €12.34 (Claude €11.90, Copilot €0.44) · recorded by MIAC
```

**Failure:**
- If the push or any PR call fails, the Finish **stops before cleanup**: the task returns to `ready`, the terminals and the worktree are untouched, and the Finish page shows the error with **Retry** and **Finish without PR**. The second option runs the plain finish.
- An HTTP 401 or 403 on a git API call shows "The token cannot create pull requests (needs Code: Read & write)".
- A failure after the PR exists, such as opening the browser, does not stop the Finish.

## 3. Done page

When `task.pullRequest` is set, a fact "Pull request" shows "PR 482 · Draft", linking to the PR. On open, the page fetches the live status (`GET .../pullrequests/{id}`) and shows Draft, Active, Completed or Abandoned. On failure it keeps the stored value without an error.

## 4. Data and IPC

- `TaskSchema`: `pullRequest` is nullable with a default of null: `{ id: number, url: string, repositoryId: string, project: string, status: 'active' | 'completed' | 'abandoned', isDraft: boolean }`.
- `ConnectionSchema`: `userUniqueName`, nullable, default null.
- `FinishOptions`: `createPullRequest: boolean`, default false for old callers.
- New IPC:
  - `tasks:prAvailability(taskId)` returns `{ available: boolean, reason: string | null, target: string | null }`.
  - `tasks:prStatus(taskId)` returns the live status, or null.
- `SetupStepKind` gains `'work-item'`. `SetupStepStatus` gains `'warn'`.
- New `AdoClient` methods, each unit-tested with a fake fetch, like the existing ones:
  - `workItem(id)`
  - `updateWorkItem(id, patch)`
  - `repository(project, name)`
  - `findActivePullRequest(project, repoId, branch)`
  - `createPullRequest(...)`
  - `pullRequest(project, repoId, id)`
- Pure helpers, unit-tested:
  - `parseAzureReposRemote(url)`
  - `planStartUpdate(current, states, settings, user)`
  - `prDescription(task, summary, usage)` (truncation)
- Telemetry:
  - events `workitem.startUpdated` with `{ moved, assigned }`, and `pr.created` / `pr.linked` / `pr.failed` with a failure kind;
  - ADO calls already appear as dependencies;
  - no titles or names;
  - update `docs/telemetry.md`.

## 5. PAT scope

- The Settings connection help text changes to "needs Work Items (Read & write) and Code (Read & write)".
- `docs/` and the README note the change.
- Existing connections keep working. The new actions fail softly with the messages above until the PAT is replaced.

## 6. Testing

- **Unit tests:**
  - remote parsing, for all four forms plus junk;
  - start planner: Proposed → InProgress, already in progress, Resolved untouched, override missing from type, assignee empty and set;
  - PR description truncation;
  - `AdoClient` request shapes;
  - Finish sequence: push fail stops before cleanup, PR fail stops before cleanup, existing PR is linked, success records and opens;
  - schema defaults.
- **Component tests:**
  - the Finish page PR checkbox, available and unavailable with its reason;
  - the error state with Retry and "Finish without PR";
  - the setup step `warn` styling;
  - the Settings repo toggles;
  - the Done page PR fact.
- **Live check against the test org.** dev.azure.com/unreliablewitness, project MIAC. The MIAC project has an Azure Repos repo, or a throwaway one is created in the test project only.
  - Start a task on a "To Do" item and check that it becomes "Doing" (Basic process).
  - Finish with the PR option and check that a draft PR exists, links the work item and shows the description.
  - Then abandon the test PR.
