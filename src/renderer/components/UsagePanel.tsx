import { useEffect, useState } from 'react';
import type { FieldsStatus, UsageTool } from '../../shared/usage';
import { AI_FIELDS } from '../../shared/usage';
import { isLive, timeline, tokenMix, type Bin } from '../../shared/usageViews';
import { aiFieldValues, renderUsageComment } from '../../shared/workItemUsage';
import { api, tryInvoke } from '../api';
import { ago, compact, eur } from '../format';
import { useClock } from '../hooks/useClock';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { useWriteCostToAdo } from '../hooks/useWriteCostToAdo';
import { useStore } from '../store';
import { TimePanel } from './TimePanel';
import { RingGauge } from './ui';

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
const ARROW = String.fromCharCode(0x2192);
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

function Timeline({ bins, live }: { bins: Bin[]; live: boolean }) {
  const maxBin = Math.max(0, ...bins.map((b) => b.costEur));
  return (
    <svg
      role="img"
      aria-label="Cost per 15 minutes, last 6 hours"
      viewBox="0 0 240 56"
      preserveAspectRatio="none"
      className="up-timeline"
    >
      {bins.map((b, i) => {
        const h = maxBin > 0 ? Math.max(2, (52 * b.costEur) / maxBin) : 2;
        const fill =
          b.dominant === 'claude-code'
            ? 'var(--chart-claude)'
            : b.dominant === 'copilot-cli'
              ? 'var(--chart-copilot)'
              : 'var(--line-strong)';
        return (
          <rect
            key={b.start}
            data-part="bin"
            className={live && i === bins.length - 1 ? 'is-live' : undefined}
            x={i * 10}
            y={56 - h}
            width={8}
            height={h}
            fill={fill}
          />
        );
      })}
    </svg>
  );
}

export function UsagePanel({
  taskId,
  now = Date.now,
}: {
  taskId: string;
  now?: () => number;
}) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const repo = useStore((s) => s.repos.find((r) => r.id === task?.repoId));
  const notify = useStore((s) => s.notify);
  const usage = useTaskUsage(taskId);
  // LIVE, the pulsing bin and the 6 h window must move on even when no new usage arrives.
  useClock(30_000);
  const [fields, setFields] = useState<FieldsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const connectionId = repo?.connectionId ?? null;
  const linked = Boolean(task?.workItem) && connectionId !== null;
  const writeCost = useWriteCostToAdo();

  useEffect(() => {
    if (!linked || !connectionId || !writeCost) return;
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
  }, [linked, connectionId, writeCost]);

  if (!task) return <div className="empty">Task not found</div>;
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

  const t = now();
  const total = usage?.billable.costEur ?? 0;
  const claude = usage?.byTool['claude-code'].costEur ?? 0;
  const copilot = usage?.byTool['copilot-cli'].costEur ?? 0;
  const mix = usage ? tokenMix(usage) : null;
  const mixRows = mix
    ? [
        ['Cache read', mix.cacheRead],
        ['Input', mix.input],
        ['Cache write', mix.cacheWrite],
        ['Output', mix.output],
      ]
    : [];
  const mixMax = Math.max(1, ...mixRows.map(([, v]) => v as number));
  const anyLive = usage ? usage.sessions.some((s) => isLive(s, t)) : false;

  return (
    <section className="usagepanel" aria-label="AI usage">
      <div className="up-col up-instrument">
        <div className="card up-box up-billable">
          <h3>Billable</h3>
          <RingGauge
            size={150}
            value={total}
            max={Math.max(total, 0.0001)}
            label={`Billable ${eur(total)}`}
            segments={[
              { value: claude, color: 'var(--chart-claude)' },
              { value: copilot, color: 'var(--chart-copilot)' },
            ]}
          />
          <div className="up-total mono">{eur(total)}</div>
          <div className="up-sub mono">
            {compact(usage?.billable.tokens ?? 0)} tokens
          </div>
          <div className="up-split">
            <span>
              <i
                className="dot"
                style={{ background: 'var(--chart-claude)' }}
              />{' '}
              Claude <b className="mono">{eur(claude)}</b>
            </span>
            <span>
              <i
                className="dot"
                style={{ background: 'var(--chart-copilot)' }}
              />{' '}
              Copilot <b className="mono">{eur(copilot)}</b>
            </span>
          </div>
        </div>
        <div className="card up-box">
          <h3>Tokens</h3>
          {mixRows.map(([label, v]) => (
            <div key={label} className="up-mixrow">
              <span className="small muted">{label}</span>
              <span className="mono small">{compact(v as number)}</span>
              <div className="up-bar">
                <span style={{ width: `${((v as number) / mixMax) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        {usage && (
          <div className="up-caption mono">{`Official list prices ${DOT} USD${ARROW}EUR ${usage.usdToEur}`}</div>
        )}
      </div>
      <div className="up-col up-main">
        <TimePanel taskId={taskId} />
        <div className="card up-box">
          <h3>Last 6 hours</h3>
          <Timeline bins={timeline(usage?.recent ?? [], t)} live={anyLive} />
        </div>
        {usage && usage.unpricedRequests > 0 && (
          <div className="check check-warn">{`${usage.unpricedRequests} ${usage.unpricedRequests === 1 ? 'request uses a model' : 'requests use models'} that ${usage.unpricedRequests === 1 ? 'is' : 'are'} not in MIAC's official price list yet, so ${usage.unpricedRequests === 1 ? 'it is' : 'they are'} not in the totals. A MIAC update will add ${usage.unpricedRequests === 1 ? 'it' : 'them'}.`}</div>
        )}
        <div className="card up-box up-sessions">
          <h3>{`Sessions ${DOT} ${usage?.sessions.length ?? 0}`}</h3>
          {usage && usage.sessions.length === 0 ? (
            <div className="empty">
              No AI usage captured for this task yet. Claude Code and Copilot
              CLI started in this task&apos;s terminals report here
              automatically.
            </div>
          ) : (
            usage && (
              <table>
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Tool</th>
                    <th>Model</th>
                    <th>Tokens</th>
                    <th>EUR</th>
                    <th>Bill</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.sessions.map((s) => (
                    <tr
                      key={s.sessionId}
                      className={s.billable ? undefined : 'is-excluded'}
                    >
                      <td>
                        {when(s.startedAt)}
                        {isLive(s, t) && (
                          <span className="live mono">LIVE</span>
                        )}
                      </td>
                      <td>{TOOL[s.tool]}</td>
                      <td className="mono">{s.models.join(', ')}</td>
                      <td className="mono">
                        {compact(
                          s.inputTokens +
                            s.outputTokens +
                            s.cacheReadTokens +
                            s.cacheWriteTokens,
                        )}
                      </td>
                      <td className="mono eur">
                        {s.unpricedRequests === s.requests
                          ? 'unpriced'
                          : `${eur(s.costUsd * usage.usdToEur)}${s.unpricedRequests > 0 ? ' + unpriced' : ''}`}
                      </td>
                      <td>
                        <label className="switch">
                          <input
                            type="checkbox"
                            aria-label="Billable"
                            checked={s.billable}
                            onChange={(e) =>
                              void setBillable(s.sessionId, e.target.checked)
                            }
                          />
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
        <div className="card up-box up-workitem">
          <h3>On the work item</h3>
          {writeCost === false ? (
            <>
              <p className="muted small">
                Writing AI cost to Azure DevOps is off (Settings, AI cost and
                invoicing). The cost stays in MIAC: this tab and the CSV export.
              </p>
              <div className="actions">
                <button type="button" className="btn" onClick={exportCsv}>
                  CSV
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="small muted">
                {task.usageSyncError
                  ? `sync failed: ${task.usageSyncError}`
                  : task.usageSyncedAt
                    ? `synced ${ago(task.usageSyncedAt)}`
                    : 'not synced yet'}
              </span>
              {!linked && (
                <p className="muted small">
                  Link the repository to an Azure DevOps connection in Settings
                  and create the task from a work item to write totals back.
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
                    ? 'Comment added on the next write to the work item'
                    : 'Comment added when the task is finished'}
              </div>
              {usage && (
                <details>
                  <summary>Comment preview</summary>
                  <pre className="usage-comment">
                    {renderUsageComment(usage, task.branch)}
                  </pre>
                </details>
              )}
              <div className="actions">
                <button type="button" className="btn" onClick={exportCsv}>
                  CSV
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={sync}
                  disabled={!linked || busy}
                >
                  Write to work item
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
