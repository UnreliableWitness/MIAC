import { z } from 'zod';

/** Work item type names come from the project's process (Agile, Scrum, Basic, custom); any string is valid. */
export type WorkItemType = string;

export const WorkItemRefSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  url: z.string().nullable().default(null),
});
export type WorkItemRef = z.infer<typeof WorkItemRefSchema>;

export const TerminalDefSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['claude', 'shell', 'run', 'copilot']),
  label: z.string(),
  command: z.string().optional(),
  /** Claude Code's session id (a UUID), so Restart resumes the same conversation. Absent on older tasks. */
  sessionId: z.string().optional(),
});
export type TerminalDef = z.infer<typeof TerminalDefSchema>;
export type NewTerminal = Omit<TerminalDef, 'id'>;

export const TaskStatusSchema = z.enum([
  'setting-up',
  'ready',
  'setup-failed',
  'finishing',
  'done',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSetupSchema = z.object({
  copy: z.boolean(),
  commands: z.array(z.string()),
  startClaude: z.boolean(),
  openShell: z.boolean(),
  openCopilot: z.boolean().default(false),
});

/** What a finished task did, captured from git just before its worktree is removed. */
export const TaskSummarySchema = z.object({
  commits: z.array(z.object({ sha: z.string(), subject: z.string() })),
  commitCount: z.number().int().min(0),
  filesChanged: z.number().int().min(0),
  insertions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  pushed: z.boolean(),
  upstream: z.string().nullable(),
  /** False when the branch's starting point could not be found, so commits and changes are unknown. */
  baseKnown: z.boolean().default(true),
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

export const StartSettingsSchema = z.object({
  moveToInProgress: z.boolean().default(true),
  assignToMe: z.boolean().default(true),
  /** Work item type -> state name. Empty means the type's first In Progress state. */
  stateOverrides: z.record(z.string(), z.string()).default({}),
});
export type StartSettings = z.infer<typeof StartSettingsSchema>;

export const PullRequestRefSchema = z.object({
  id: z.number().int(),
  url: z.string(),
  repositoryId: z.string(),
  project: z.string(),
  repo: z.string(),
  status: z.enum(['active', 'completed', 'abandoned']),
  isDraft: z.boolean(),
});
export type PullRequestRef = z.infer<typeof PullRequestRefSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  repoId: z.string().min(1),
  name: z.string(),
  workItem: WorkItemRefSchema.nullable(),
  slug: z.string().min(1),
  branch: z.string().min(1),
  worktreePath: z.string().min(1),
  baseRef: z.string().min(1),
  /** The commit the branch started from, recorded when its worktree is made; null for older tasks. */
  baseSha: z.string().nullable().default(null),
  status: TaskStatusSchema,
  setup: TaskSetupSchema,
  terminals: z.array(TerminalDefSchema),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  usageSyncedAt: z.string().nullable().default(null),
  usageSyncError: z.string().nullable().default(null),
  usageCommentId: z.number().int().nullable().default(null),
  /** Null for tasks finished before MIAC recorded summaries, and while a task is open. */
  summary: TaskSummarySchema.nullable().default(null),
  pullRequest: PullRequestRefSchema.nullable().default(null),
});
export type Task = z.infer<typeof TaskSchema>;

export const RepoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  baseBranch: z.string().min(1),
  connectionId: z.string().nullable(),
  miacYmlFound: z.boolean(),
  workItemOnStart: StartSettingsSchema.default({
    moveToInProgress: true,
    assignToMe: true,
    stateOverrides: {},
  }),
});
export type Repo = z.infer<typeof RepoSchema>;

export const StateSchema = z.object({
  version: z.literal(1),
  repos: z.array(RepoSchema),
  tasks: z.array(TaskSchema),
});
export type State = z.infer<typeof StateSchema>;

export type MiacConfig = {
  base: string;
  branch: string;
  copy: string[];
  setup: string[];
  run: Record<string, string>;
  found: boolean;
};

export type TaskView = Task & { worktreeMissing: boolean };

export type CreateTaskInput = {
  repoId: string;
  baseRef: string;
  name: string;
  workItem: WorkItemRef | null;
  branch: string;
  copy: boolean;
  commands: string[];
  startClaude: boolean;
  openShell: boolean;
  openCopilot?: boolean;
};

export type FinishOptions = {
  closeTerminals: boolean;
  removeWorktree: boolean;
  deleteBranch: boolean;
  syncUsage: boolean;
  createPullRequest?: boolean;
};

export type GitFile = { status: string; path: string };
export type GitSummary = {
  branch: string;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  files: GitFile[];
};
export type FinishChecks = {
  uncommitted: GitFile[];
  unpushed: number;
  runningTerminals: number;
};

export type SetupStepKind =
  | 'fetch'
  | 'worktree'
  | 'copy'
  | 'task-file'
  | 'command'
  | 'terminals'
  | 'work-item';
export type SetupStepDef = {
  kind: SetupStepKind;
  label: string;
  detail: string;
  command?: string;
};
export type SetupStepStatus = 'todo' | 'running' | 'done' | 'warn' | 'failed';
export type SetupEvent =
  | {
      taskId: string;
      type: 'step';
      index: number;
      status: SetupStepStatus;
      detail?: string;
      ms?: number;
    }
  | { taskId: string; type: 'log'; line: string }
  | { taskId: string; type: 'finished'; ok: boolean; failedStep?: number };
export type SetupState = {
  steps: {
    def: SetupStepDef;
    status: SetupStepStatus;
    detail?: string;
    ms?: number;
  }[];
  log: string[];
  finished: boolean;
  ok: boolean | null;
  failedStep: number | null;
};

export type Notice = {
  id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
};

export const ConnectionStatusSchema = z.enum([
  'unknown',
  'ok',
  'unauthorized',
  'unreachable',
]);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

export const ConnectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  organizationUrl: z.string().min(1),
  project: z.string().min(1),
  user: z.string().nullable(),
  status: ConnectionStatusSchema,
  checkedAt: z.string().nullable(),
  userUniqueName: z.string().nullable().default(null),
});
export type Connection = z.infer<typeof ConnectionSchema>;

export const ConnectionsFileSchema = z.object({
  version: z.literal(1),
  connections: z.array(
    ConnectionSchema.extend({ tokenCiphertext: z.string() }),
  ),
});
export type ConnectionsFile = z.infer<typeof ConnectionsFileSchema>;

/** What the renderer sends to save a connection. The PAT travels only in this direction. */
export type ConnectionInput = {
  id?: string;
  name?: string;
  organizationUrl: string;
  project: string;
  pat: string;
};

export type Iteration = { path: string; name: string };
/** The current sprint as the sprint page needs it; ADO leaves the dates null until someone sets them. */
export type SprintIteration = Iteration & {
  id: string;
  startDate: string | null;
  finishDate: string | null;
};

export type WorkItemSummary = {
  id: string;
  type: string;
  title: string;
  state: string;
  areaPath: string;
  iterationPath: string;
  assignedTo: string | null;
  url: string;
};

export type WorkItemSearch = { scope: 'sprint' | 'mine'; text: string };

/** A sprint backlog item: the picker's fields plus remaining work (hours, null when unset). */
export type SprintItem = WorkItemSummary & { remainingWork: number | null };
/** One grid row of the sprint page, in ADO's backlog order; children follow their parent. */
export type SprintRow = {
  item: SprintItem;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
};
export type Sprint = { iteration: SprintIteration | null; rows: SprintRow[] };

/** A state of a work item type, with ADO's color (`#rrggbb`) and state category (Proposed, InProgress, Completed, Removed...). */
export type WorkItemStateMeta = {
  name: string;
  color: string | null;
  category: string | null;
};
/** A work item type of the project: its color, its real ADO icon as a data URL (null when it could not be fetched) and its states. */
export type WorkItemTypeMeta = {
  name: string;
  color: string | null;
  icon: string | null;
  states: WorkItemStateMeta[];
};

/** A Markdown file in a task's worktree; `changed` is relative to the task's base. */
export type DocFile = { path: string; changed: 'new' | 'modified' | null };
