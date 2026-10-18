import { ChevronDown16Regular, Send16Regular } from '@fluentui/react-icons';
import { useCallback, useRef, useState } from 'react';
import type { ReviewComment, ReviewState } from '../../../shared/review';
import type { TaskView } from '../../../shared/types';
import { api, tryInvoke } from '../../api';
import { readSendTarget, writeSendTarget } from '../../docs/docsPrefs';
import { buildReviewPrompt } from '../../review/reviewPrompt';
import { useStore } from '../../store';
import { track } from '../../telemetry';
import { focusTerminal, pasteInto } from '../../terminalRegistry';
import { PopupMenu } from '../ui';
import { plural } from '../../format';

/** Agent tabs only: a shell would run each line of the paste. */
const AGENTS = new Set(['claude', 'copilot', 'opencode']);

export function SendComments({
  task,
  comments,
  repoName,
  multiRepo,
  onSent,
}: {
  task: TaskView;
  comments: ReviewComment[];
  repoName: (workspaceId: string) => string;
  multiRepo: boolean;
  onSent: (s: ReviewState) => void;
}) {
  const notify = useStore((s) => s.notify);
  const [menu, setMenu] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [chosen, setChosen] = useState<string | null>(() =>
    readSendTarget(task.id),
  );
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  const close = useCallback(() => setMenu(false), []);
  const targets = task.terminals.filter((t) => AGENTS.has(t.kind));
  const open = comments.filter((c) => c.status === 'open');
  const target =
    targets.find((t) => t.id === chosen) ??
    targets.find((t) => t.kind === 'claude') ??
    targets[0];

  const send = async (id: string) => {
    if (busy.current) return;
    busy.current = true;
    setSending(true);
    try {
      await sendNow(id);
    } finally {
      busy.current = false;
      setSending(false);
    }
  };
  const sendNow = async (id: string) => {
    setMenu(false);
    const t = targets.find((x) => x.id === id);
    if (!t || open.length === 0) return;
    const running = await api()
      .invoke('terminals:isRunning', id)
      .catch(() => false);
    if (!running) {
      notify('warn', `${t.label} is not running`);
      return;
    }
    const inRepo = (c: ReviewComment, p: string) =>
      multiRepo ? `${repoName(c.workspaceId)}/${p}` : p;
    const items = open.map((c) => ({
      path: inRepo(c, c.path),
      ...(c.oldPath ? { oldPath: inRepo(c, c.oldPath) } : {}),
      side: c.side,
      startLine: c.startLine,
      endLine: c.endLine,
      snippet: c.snippet,
      text: c.text,
    }));
    if (
      !pasteInto(id, (bracketed) =>
        buildReviewPrompt(items, { singleLine: !bracketed }),
      )
    ) {
      notify('warn', `${t.label} is not open`);
      return;
    }
    writeSendTarget(task.id, id);
    setChosen(id);
    const s = await tryInvoke(
      () =>
        api().invoke(
          'review:markSent',
          task.id,
          open.map((c) => c.id),
        ),
      notify,
    );
    if (s) {
      onSent(s);
      track('review.commentsSent', { count: open.length });
    }
    useStore.getState().setTab(task.id, id);
    requestAnimationFrame(() => focusTerminal(id));
  };

  if (!target)
    return (
      <button type="button" className="btn btn-sm" disabled>
        <Send16Regular aria-hidden="true" />
        Send comments: Open a Claude Code tab first
      </button>
    );
  if (open.length === 0)
    return (
      <button type="button" className="btn btn-sm" disabled>
        No open comments to send
      </button>
    );
  return (
    <span className="split-btn">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={sending}
        onClick={() => void send(target.id)}
      >
        <Send16Regular aria-hidden="true" />
        {`Send ${plural(open.length, 'comment')} to ${target.label}`}
      </button>
      {targets.length > 1 && (
        <button
          ref={setAnchor}
          type="button"
          className="btn btn-primary btn-sm"
          aria-label="Choose terminal"
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <ChevronDown16Regular aria-hidden="true" />
        </button>
      )}
      <PopupMenu label="Send to" anchor={anchor} open={menu} onClose={close}>
        {targets.map((t) => (
          <button
            key={t.id}
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => void send(t.id)}
          >
            <span className="menu-title">{t.label}</span>
          </button>
        ))}
      </PopupMenu>
    </span>
  );
}
