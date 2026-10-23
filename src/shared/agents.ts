export type AgentId = 'claude' | 'copilot' | 'opencode';

export type AgentProbe = {
  found: boolean;
  version: string | null;
  path: string | null;
};

export type AgentsDetected = {
  checkedAt: string;
  agents: Record<AgentId, AgentProbe>;
  shell: { label: string };
};

export const AGENT_IDS: AgentId[] = ['claude', 'copilot', 'opencode'];

export const AGENT_LABELS: Record<AgentId, string> = {
  claude: 'Claude Code',
  copilot: 'GitHub Copilot CLI',
  opencode: 'OpenCode',
};

export const INSTALL_COMMANDS: Record<AgentId, string> = {
  claude: 'npm i -g @anthropic-ai/claude-code',
  copilot: 'npm i -g @github/copilot',
  opencode: 'npm i -g opencode-ai',
};
