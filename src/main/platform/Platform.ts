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
  /** Run one command line non-interactively, with the user's PATH loaded. */
  shellCommand(cmd: string): Command;
  /** Start Claude Code with a first prompt. */
  claudeCommand(prompt: string): Command;
  /** Start GitHub Copilot CLI. */
  copilotCommand(): Command;
  /** Open a folder in the editor. */
  editorCommand(path: string): Command;
}
