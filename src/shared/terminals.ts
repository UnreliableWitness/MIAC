import { z } from 'zod';

/** The tabs a new task opens when nothing else is chosen (Start, and New task's pre-ticked boxes). */
export const DefaultTerminalsSchema = z.object({
  claude: z.boolean().default(true),
  copilot: z.boolean().default(false),
  opencode: z.boolean().default(false),
  shell: z.boolean().default(true),
});
export type DefaultTerminals = z.infer<typeof DefaultTerminalsSchema>;
export const defaultTerminals = (): DefaultTerminals =>
  DefaultTerminalsSchema.parse({});

/** The task setup flags for a default-terminals choice. */
export function setupTabsFrom(d: DefaultTerminals): {
  startClaude: boolean;
  openShell: boolean;
  openCopilot: boolean;
  openOpencode: boolean;
} {
  return {
    startClaude: d.claude,
    openShell: d.shell,
    openCopilot: d.copilot,
    openOpencode: d.opencode,
  };
}
