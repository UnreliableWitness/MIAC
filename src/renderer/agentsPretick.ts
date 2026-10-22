import type { AgentsDetected } from '../shared/agents';
import type { DefaultTerminals } from '../shared/terminals';

/** The first found of Claude Code, OpenCode, Copilot is ticked; the shell always. */
export function pretick(detected: AgentsDetected): DefaultTerminals {
  const first = (['claude', 'opencode', 'copilot'] as const).find(
    (id) => detected.agents[id].found,
  );
  return {
    claude: first === 'claude',
    copilot: first === 'copilot',
    opencode: first === 'opencode',
    shell: true,
  };
}
