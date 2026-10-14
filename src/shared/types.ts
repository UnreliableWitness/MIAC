import { z } from 'zod';

export const WorkItemTypeSchema = z.enum(['User Story', 'Bug', 'Task']);
export type WorkItemType = z.infer<typeof WorkItemTypeSchema>;

export const WorkItemRefSchema = z.object({
  id: z.string().min(1),
  type: WorkItemTypeSchema,
  title: z.string().min(1),
});
export type WorkItemRef = z.infer<typeof WorkItemRefSchema>;

export const TerminalDefSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['claude', 'shell', 'run']),
  label: z.string(),
  command: z.string().optional(),
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
});

export const TaskSchema = z.object({
  id: z.string().min(1),
  repoId: z.string().min(1),
  name: z.string(),
  workItem: WorkItemRefSchema.nullable(),
  slug: z.string().min(1),
  branch: z.string().min(1),
  worktreePath: z.string().min(1),
  baseRef: z.string().min(1),
  status: TaskStatusSchema,
  setup: TaskSetupSchema,
  terminals: z.array(TerminalDefSchema),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type Task = z.infer<typeof TaskSchema>;

export const RepoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  baseBranch: z.string().min(1),
  connectionId: z.string().nullable(),
  miacYmlFound: z.boolean(),
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
};

export type FinishOptions = {
  closeTerminals: boolean;
  removeWorktree: boolean;
  deleteBranch: boolean;
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
  | 'terminals';
export type SetupStepDef = {
  kind: SetupStepKind;
  label: string;
  detail: string;
  command?: string;
};
export type SetupStepStatus = 'todo' | 'running' | 'done' | 'failed';
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
