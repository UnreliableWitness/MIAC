/** `env` is merged over the process environment by every caller that starts the command. */
export type Command = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export interface Platform {
  /** Short name shown on the shell tab, e.g. "zsh" or "PowerShell". */
  shellLabel: string;
  /** An interactive shell for a terminal tab. */
  interactiveShell(): Command;
  /**
   * Run one setup command line non-interactively, with the user's PATH loaded. Its output goes to pipes
   * (SetupRunner), and the exit code reports success.
   */
  shellCommand(cmd: string): Command;
  /**
   * Run one command line in a terminal (a pty, e.g. the dev server), with the user's PATH loaded. The
   * program keeps the console: no pipe in between, so colour, UTF-8 output and unbuffered logs survive.
   */
  runCommand(cmd: string): Command;
  /**
   * Run a task's setup command lines one after another in a terminal (the Setup tab), printing each before it runs
   * and stopping at the first one that fails.
   */
  setupCommands(cmds: string[]): Command;
  /** Copy a folder as a cheap copy-on-write clone; absent where the file system has none. `dest` must not exist. */
  cloneDir?(src: string, dest: string): Command;
  /**
   * Start Claude Code. `context` (the task) is appended to its system prompt, so Claude knows the task but waits
   * for the user's first message; null when resuming, as the session already has it. `flags` are Shellie's own
   * (session id, resume).
   */
  claudeCommand(context: string | null, flags?: string[]): Command;
  /** Start GitHub Copilot CLI. */
  copilotCommand(): Command;
  /** Start OpenCode (no AI cost tracking). */
  opencodeCommand(): Command;
  /** Where .NET stores a project's user secrets (`secrets.json` inside); the folder may not exist. */
  userSecretsDir(id: string): string;
  /** Open a folder in the editor. */
  editorCommand(path: string): Command;
  /** Open a file in the editor at a line (and column), in the worktree's window. */
  editorGotoCommand(
    worktree: string,
    file: string,
    line?: number,
    col?: number,
  ): Command;
}
