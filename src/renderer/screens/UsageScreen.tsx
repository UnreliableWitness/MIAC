import { useEffect, useState } from 'react';
import type { FieldsStatus, UsageTool } from '../../shared/usage';
import { AI_FIELDS } from '../../shared/usage';
import { aiFieldValues, renderUsageComment } from '../../shared/workItemUsage';
import { api, tryInvoke } from '../api';
import { TopBar } from '../components/TopBar';
import { ago, compact, eur } from '../format';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { useStore } from '../store';

const TOOL: Record<UsageTool, string> = {
  'claude-code': 'Claude Code',
  'copilot-cli': 'Copilot CLI',
};
const FIELD_LABEL: Record<(typeof AI_FIELDS)[number], string> = {
  'Custom.AICost': 'AI Cost (EUR)',
  'Custom.AICostClaude': 'AI Cost Claude',
  'Custom.AICostCopilot': 'AI Cost Copilot',
  'Custom.AITokens': 'AI Tokens',
};
const DOT = String.fromCharCode(0xb7);
const sessions = (n: number) => `${n} session${n === 1 ? '' : 's'}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export function UsageScreen({ taskId }: { taskId: string }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const repo = useStore((s) => s.repos.find((r) => r.id === task?.repoId));
  const go = useStore((s) => s.go);
  const notify = useStore((s) => s.notify);
  const usage = useTaskUsage(taskId);
  const [fields, setFields] = useState<FieldsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const connectionId = repo?.connectionId ?? null;
  const linked = Boolean(task?.workItem) && connectionId !== null;

  useEffect(() => {
    if (!linked || !connectionId) return;
    let live = true;
    void api()
      .invoke('usage:fieldsStatus', connectionId)
      .then((f) => {
        if (live) setFields(f);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [linked, connectionId]);

  const back = () => go({ kind: 'workspace' });
  const backLink = (
    <a
      href="#"
      className="spacer"
      onClick={(e) => {
        e.preventDefault();
        back();
      }}
    >
      Back to task
    </a>
  );
  if (!task)
    return (
      <>
        <TopBar crumb="AI usage">{backLink}</TopBar>
        <div className="empty">Task not found</div>
      </>
    );
  const typeFields = fields?.types.find(
    (t) => t.type.toLowerCase() === task.workItem?.type.toLowerCase(),
  );
  const values = usage ? aiFieldValues(usage) : null;

  const sync = async () => {
    setBusy(true);
    const r = await tryInvoke(() => api().invoke('usage:sync', taskId), notify);
    setBusy(false);
    if (r && !r.ok) notify('error', `Sync failed: ${r.error}`);
    else if (r)
      notify(
        'info',
        r.fieldsWritten.length > 0
          ? `Wrote ${r.fieldsWritten.length} field(s) to work item ${task.workItem?.id}`
          : 'Nothing to write: the work item type has none of the AI cost fields',
      );
  };
  const exportCsv = async () => {
    const csv = await tryInvoke(
      () => api().invoke('usage:exportCsv', taskId),
      notify,
    );
    if (csv === undefined) return;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `miac-usage-${task.slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const setBillable = (sessionId: string, billable: boolean) =>
    tryInvoke(
      () => api().invoke('usage:setBillable', taskId, sessionId, billable),
      notify,
    );

  const tile = (label: string, amount: number, note: string) => (
    <div className="usage-tile">
      <span className="small muted">{label}</span>
      <span className="amount">{eur(amount)}</span>
      <span className="small muted">{note}</span>
    </div>
  );

  return (
    <>
      <TopBar
        crumb={`${repo?.name ?? ''} / ${task.workItem?.id ?? task.name} / AI usage`}
      >
        {backLink}
      </TopBar>
      <div className="usage">
        <main className="usage-main">
          <h1>{task.workItem?.title ?? task.name}</h1>
          <div className="muted">
            {task.workItem
              ? `${task.workItem.type} ${task.workItem.id}`
              : 'Blank task'}
          </div>
          {usage && (
            <div className="usage-tiles">
              {tile(
                'Billable AI cost',
                usage.billable.costEur,
                `official list prices ${DOT} USD to EUR ${usage.usdToEur}`,
              )}
              {tile(
                'Claude Code',
                usage.byTool['claude-code'].costEur,
                `${sessions(usage.byTool['claude-code'].sessions)} ${DOT} ${compact(usage.byTool['claude-code'].tokens)} tokens`,
              )}
              {tile(
                'Copilot CLI',
                usage.byTool['copilot-cli'].costEur,
                `${sessions(usage.byTool['copilot-cli'].sessions)} ${DOT} ${compact(usage.byTool['copilot-cli'].tokens)} tokens`,
              )}
            </div>
          )}
          {usage && usage.unpricedRequests > 0 && (
            <div className="check check-warn">{`${usage.unpricedRequests} ${usage.unpricedRequests === 1 ? 'request uses a model' : 'requests use models'} that ${usage.unpricedRequests === 1 ? 'is' : 'are'} not in MIAC's official price list yet, so ${usage.unpricedRequests === 1 ? 'it is' : 'they are'} not in the totals. A MIAC update will add ${usage.unpricedRequests === 1 ? 'it' : 'them'}.`}</div>
          )}
          {usage && usage.sessions.length === 0 ? (
            <div className="empty">
              No AI usage captured for this task yet. Claude Code and Copilot
              CLI started in this task&apos;s terminals report here
              automatically.
            </div>
          ) : (
            usage && (
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Tool</th>
                    <th>Model</th>
                    <th>Input</th>
                    <th>Output</th>
                    <th>Cache read</th>
                    <th>Cache write</th>
                    <th>Cost</th>
                    <th>Billable</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.sessions.map((s) => (
                    <tr key={s.sessionId}>
                      <td>{when(s.startedAt)}</td>
                      <td>{TOOL[s.tool]}</td>
                      <td className="mono">{s.models.join(', ')}</td>
                      <td className="mono">{compact(s.inputTokens)}</td>
                      <td className="mono">{compact(s.outputTokens)}</td>
                      <td className="mono">{compact(s.cacheReadTokens)}</td>
                      <td className="mono">{compact(s.cacheWriteTokens)}</td>
                      <td className="mono">
                        {s.unpricedRequests === s.requests
                          ? 'unpriced'
                          : `${eur(s.costUsd * usage.usdToEur)}${s.unpricedRequests > 0 ? ' + unpriced' : ''}`}
                      </td>
                      <td>
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={s.billable}
                            onChange={(e) =>
                              void setBillable(s.sessionId, e.target.checked)
                            }
                          />
                          Billable
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </main>
        <aside className="usage-side">
          <div className="section-head">
            <h2>On the work item</h2>
            <span className="small muted">
              {task.usageSyncError
                ? `sync failed: ${task.usageSyncError}`
                : task.usageSyncedAt
                  ? `synced ${ago(task.usageSyncedAt)}`
                  : 'not synced yet'}
            </span>
          </div>
          {!linked && (
            <p className="muted small">
              Link the repository to an Azure DevOps connection in Settings and
              create the task from a work item to write totals back.
            </p>
          )}
          {values && (
            <dl className="usage-fields">
              {AI_FIELDS.map((f) => (
                <div key={f}>
                  <dt>{FIELD_LABEL[f]}</dt>
                  <dd className="mono">
                    {f === 'Custom.AITokens'
                      ? values[f].toLocaleString('en-US')
                      : values[f].toFixed(2)}
                  </dd>
                  {typeFields && !typeFields.present.includes(f) && (
                    <dd className="small muted">{`not on ${typeFields.type}`}</dd>
                  )}
                </div>
              ))}
            </dl>
          )}
          <div className="label">
            {task.usageCommentId
              ? `Comment posted (id ${task.usageCommentId})`
              : task.status === 'done'
                ? 'Comment added on the next Sync now'
                : 'Comment added when the task is finished'}
          </div>
          {usage && (
            <pre className="usage-comment">
              {renderUsageComment(usage, task.branch)}
            </pre>
          )}
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={sync}
              disabled={!linked || busy}
            >
              Sync now
            </button>
            <button type="button" className="btn" onClick={exportCsv}>
              Export CSV
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
