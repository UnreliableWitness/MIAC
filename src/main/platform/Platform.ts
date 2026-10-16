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
  /** Start Claude Code with a first prompt. */
  claudeCommand(prompt: string): Command;
  /** Start GitHub Copilot CLI. */
  copilotCommand(): Command;
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
