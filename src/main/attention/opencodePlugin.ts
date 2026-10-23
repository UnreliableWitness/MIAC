import { opencodePermission } from '../secrets/deny';

/**
 * The OpenCode plugin Shellie writes to `<userData>/opencode/shellie-attention.js` and loads through
 * OPENCODE_CONFIG_CONTENT. It reports when the main session waits on the developer. Plain JS, no imports: OpenCode
 * (Bun) loads it as is. OpenCode rejects modules with exports other than plugin functions, so it exports one.
 */
export const OPENCODE_PLUGIN_SOURCE = `// Written by Shellie on every start; edits are overwritten.
export const ShellieAttention = async () => {
  const url = process.env.SHELLIE_ATTENTION_URL;
  const token = process.env.SHELLIE_ATTENTION_TOKEN;
  const terminalId = process.env.SHELLIE_TERMINAL_ID;
  if (!url || !token || !terminalId) return {};
  const children = new Set();
  let last = '';
  const send = (state, kind, message) => {
    const key = state + '|' + (kind || '') + '|' + (message || '');
    if (key === last) return;
    last = key;
    const body = { terminalId, state };
    if (kind) body.kind = kind;
    if (message) body.message = String(message).slice(0, 2000);
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shellie-token': token },
      body: JSON.stringify(body),
    }).catch(() => {});
  };
  return {
    event: async ({ event }) => {
      try {
        const p = event.properties || {};
        if (event.type === 'session.created' || event.type === 'session.updated') {
          if (p.info && p.info.parentID) children.add(p.info.id || p.sessionID);
          return;
        }
        const child = p.sessionID && children.has(p.sessionID);
        // A subagent's prompt blocks the run, but its status, idle and error events would give a false done.
        if (child && !/^(permission|question)\./.test(event.type)) return;
        switch (event.type) {
          case 'permission.asked':
            return send('blocked', 'permission', [p.permission, (p.patterns || []).join(' ')].filter(Boolean).join(': '));
          case 'question.asked':
            return send('blocked', 'question');
          case 'permission.replied':
          case 'question.replied':
          case 'question.rejected':
            return send('working');
          case 'session.status':
            if (!p.status) return;
            return send(p.status.type === 'idle' ? 'done' : 'working');
          case 'session.idle':
            return send('done');
          case 'session.error':
            return send('done', 'error', p.error && (p.error.name || p.error.message));
        }
      } catch {}
    },
  };
};
`;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** A permission entry as a pattern map: a plain action ("allow") becomes `{"*": "allow"}`. */
const patterns = (v: unknown): Record<string, unknown> =>
  isObject(v) ? v : typeof v === 'string' ? { '*': v } : {};

/** The developer's own `permission` with the deny entries for the secret files added to `read` and `bash`. */
function withDeny(existing: unknown, paths: string[]) {
  const own = isObject(existing)
    ? existing
    : typeof existing === 'string'
      ? { '*': existing }
      : {};
  const deny = opencodePermission(paths);
  return {
    ...own,
    read: { ...patterns(own.read), ...deny.read },
    bash: { ...patterns(own.bash), ...deny.bash },
  };
}

/**
 * OPENCODE_CONFIG_CONTENT with Shellie's plugin added, and `instructions` (a file with the `shellie run` line)
 * when given, and `permission` deny entries for `denyPaths` (untracked secret files); undefined when the developer's own value is not a JSON object.
 */
export function opencodeConfigContent(
  existing: string | undefined,
  pluginPath: string,
  instructions?: string,
  denyPaths: string[] = [],
): string | undefined {
  const extra = (config: { instructions?: unknown; permission?: unknown }) => ({
    ...(instructions
      ? {
          instructions: [
            ...(Array.isArray(config.instructions) ? config.instructions : []),
            instructions,
          ],
        }
      : {}),
    ...(denyPaths.length > 0
      ? { permission: withDeny(config.permission, denyPaths) }
      : {}),
  });
  if (!existing) return JSON.stringify({ plugin: [pluginPath], ...extra({}) });
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return undefined;
  const config = parsed as {
    plugin?: unknown;
    instructions?: unknown;
    permission?: unknown;
  };
  const plugins = Array.isArray(config.plugin) ? config.plugin : [];
  return JSON.stringify({
    ...config,
    plugin: [...plugins, pluginPath],
    ...extra(config),
  });
}
