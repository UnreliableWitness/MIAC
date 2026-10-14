import { useEffect, useState } from 'react';
import type {
  AppSettings,
  FieldsStatus,
  Rate,
  ReceiverStatus,
} from '../../shared/usage';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';

type Draft = {
  id: string;
  label: string;
  match: string;
  minInputTokens: string;
  fast: boolean;
  inputPerM: string;
  cachedInputPerM: string;
  cacheWritePerM: string;
  outputPerM: string;
};
type SettingsDraft = {
  usdToEur: string;
  markupPct: string;
  receiverPort: string;
  hourlySync: boolean;
};

const toDraft = (r: Rate): Draft => ({
  id: r.id,
  label: r.label,
  match: r.match.join(', '),
  minInputTokens: String(r.minInputTokens),
  fast: r.fast,
  inputPerM: String(r.inputPerM),
  cachedInputPerM: String(r.cachedInputPerM),
  cacheWritePerM: String(r.cacheWritePerM),
  outputPerM: String(r.outputPerM),
});
/** A number typed in a field, or null when it is blank or not a number (Number('') would be 0). */
const parseNumber = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const PRICE_FIELDS = [
  ['inputPerM', 'input per 1M'],
  ['cachedInputPerM', 'cached input per 1M'],
  ['cacheWritePerM', 'cache write per 1M'],
  ['outputPerM', 'output per 1M'],
] as const;

/** The rate, or the first error naming the row and the field. */
const fromDraft = (d: Draft): Rate | string => {
  const numbers: Record<string, number> = {};
  for (const [key, name] of [
    ['minInputTokens', 'min input tokens'],
    ...PRICE_FIELDS,
  ] as const) {
    const n = parseNumber(d[key]);
    if (n === null) return `${d.label}: ${name} must be a number`;
    numbers[key] = n;
  }
  return {
    id: d.id,
    label: d.label,
    match: d.match
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    minInputTokens: numbers.minInputTokens,
    fast: d.fast,
    inputPerM: numbers.inputPerM,
    cachedInputPerM: numbers.cachedInputPerM,
    cacheWritePerM: numbers.cacheWritePerM,
    outputPerM: numbers.outputPerM,
  };
};

function InvoicingPart() {
  const notify = useStore((s) => s.notify);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [status, setStatus] = useState<ReceiverStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void tryInvoke(() => api().invoke('settings:get'), notify).then((s) => {
      if (live && s)
        setDraft({
          usdToEur: String(s.usdToEur),
          markupPct: String(s.markupPct),
          receiverPort: String(s.receiverPort),
          hourlySync: s.hourlySync,
        });
    });
    const load = () =>
      api()
        .invoke('usage:receiverStatus')
        .then((r) => {
          if (live) setStatus(r);
        })
        .catch(() => undefined);
    void load();
    const off = api().on('usage:receiverStatus', (r) => setStatus(r));
    return () => {
      live = false;
      off();
    };
  }, [notify]);

  const save = async () => {
    if (!draft) return;
    const usdToEur = parseNumber(draft.usdToEur);
    const markupPct = parseNumber(draft.markupPct);
    const receiverPort = parseNumber(draft.receiverPort);
    if (usdToEur === null || markupPct === null || receiverPort === null) {
      const field =
        usdToEur === null
          ? 'USD to EUR'
          : markupPct === null
            ? 'Markup %'
            : 'Usage receiver port';
      setError(`${field} must be a number`);
      return;
    }
    setError(null);
    const settings: AppSettings = {
      version: 1,
      usdToEur,
      markupPct,
      receiverPort,
      hourlySync: draft.hourlySync,
    };
    const saved = await tryInvoke(
      () => api().invoke('settings:save', settings),
      notify,
    );
    if (saved) notify('info', 'Settings saved');
  };

  return (
    <div className="list">
      {draft && (
        <div className="conn-form">
          <span>Invoice currency</span>
          <span>EUR</span>
          <label htmlFor="cost-fx">USD to EUR</label>
          <input
            id="cost-fx"
            className="field mono"
            type="number"
            step="0.0001"
            value={draft.usdToEur}
            onChange={(e) => setDraft({ ...draft, usdToEur: e.target.value })}
          />
          <label htmlFor="cost-markup">Markup %</label>
          <input
            id="cost-markup"
            className="field mono"
            type="number"
            value={draft.markupPct}
            onChange={(e) => setDraft({ ...draft, markupPct: e.target.value })}
          />
          <label htmlFor="cost-port">Usage receiver port</label>
          <input
            id="cost-port"
            className="field mono"
            type="number"
            value={draft.receiverPort}
            onChange={(e) =>
              setDraft({ ...draft, receiverPort: e.target.value })
            }
          />
          <span />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.hourlySync}
              onChange={(e) =>
                setDraft({ ...draft, hourlySync: e.target.checked })
              }
            />
            Sync totals to work items every hour
          </label>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={save}>
              Save settings
            </button>
          </div>
          {error && (
            <div
              role="alert"
              className="conn-status-bad"
              style={{ gridColumn: '1 / -1' }}
            >
              {error}
            </div>
          )}
        </div>
      )}
      {status && (
        <div className="conn-form">
          <div
            style={{ gridColumn: '1 / -1' }}
            className={status.listening ? 'conn-status-ok' : 'conn-status-bad'}
          >
            {status.listening
              ? `Listening on 127.0.0.1:${status.port}`
              : (status.error ?? 'Usage receiver is not running')}
          </div>
          <div style={{ gridColumn: '1 / -1' }} className="small muted">
            {`Copilot CLI: ${status.copilot.records} records captured, ${status.copilot.unreadable} unreadable (unverified: built from documentation)`}
          </div>
        </div>
      )}
    </div>
  );
}

function RatesPart() {
  const notify = useStore((s) => s.notify);
  const [rows, setRows] = useState<Draft[]>([]);
  const [officialAsOf, setOfficialAsOf] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void tryInvoke(() => api().invoke('rates:list'), notify).then((r) => {
      if (live && r) {
        setRows(r.rates.map(toDraft));
        setOfficialAsOf(r.officialAsOf);
      }
    });
    return () => {
      live = false;
    };
  }, [notify]);

  const patch = (id: string, change: Partial<Draft>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...change } : r)));

  const save = async () => {
    const parsed = rows.map(fromDraft);
    const bad = parsed.find((r) => typeof r === 'string');
    if (bad !== undefined) {
      setError(bad);
      return;
    }
    setError(null);
    const valid = parsed.filter((r): r is Rate => typeof r !== 'string');
    const saved = await tryInvoke(
      () => api().invoke('rates:save', valid),
      notify,
    );
    if (saved) {
      setRows(saved.map(toDraft));
      notify('info', 'Rates saved');
    }
  };
  const reset = async () => {
    const fresh = await tryInvoke(() => api().invoke('rates:reset'), notify);
    setConfirming(false);
    if (fresh) setRows(fresh.map(toDraft));
  };

  return (
    <div className="list">
      <div style={{ overflowX: 'auto' }}>
        <table className="rates">
          <thead>
            <tr>
              <th>Label</th>
              <th>Models</th>
              <th>Min input tokens</th>
              <th>Fast</th>
              <th>Input</th>
              <th>Cached input</th>
              <th>Cache write</th>
              <th>Output</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <input
                    className="field"
                    aria-label={`${r.label} label`}
                    value={r.label}
                    onChange={(e) => patch(r.id, { label: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="field mono"
                    aria-label={`${r.label} models`}
                    value={r.match}
                    onChange={(e) => patch(r.id, { match: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="field mono"
                    type="number"
                    aria-label={`${r.label} min input tokens`}
                    value={r.minInputTokens}
                    onChange={(e) =>
                      patch(r.id, { minInputTokens: e.target.value })
                    }
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${r.label} fast`}
                    checked={r.fast}
                    onChange={(e) => patch(r.id, { fast: e.target.checked })}
                  />
                </td>
                {PRICE_FIELDS.map(([key, name]) => (
                  <td key={key}>
                    <input
                      className="field mono"
                      type="number"
                      step="any"
                      aria-label={`${r.label} ${name}`}
                      value={r[key]}
                      onChange={(e) => patch(r.id, { [key]: e.target.value })}
                    />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label={`Delete ${r.label}`}
                    onClick={() =>
                      setRows((rs) => rs.filter((x) => x.id !== r.id))
                    }
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="list-row">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            setRows((rs) => [
              ...rs,
              toDraft({
                id: `custom-${Date.now()}`,
                label: 'New rate',
                match: ['model-id'],
                minInputTokens: 0,
                fast: false,
                inputPerM: 0,
                cachedInputPerM: 0,
                cacheWritePerM: 0,
                outputPerM: 0,
              }),
            ])
          }
        >
          Add rate
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={save}>
          Save rates
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setConfirming(true)}
          disabled={confirming}
        >
          Reset to official prices
        </button>
      </div>
      {error && (
        <div
          role="alert"
          className="conn-status-bad"
          style={{ padding: '10px 16px' }}
        >
          {error}
        </div>
      )}
      {confirming && (
        <div className="conn-confirm" role="status">
          <span>{`Replace your rates with the official prices of ${officialAsOf}?`}</span>
          <button type="button" className="btn btn-warn btn-sm" onClick={reset}>
            Yes, reset
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      )}
      <div className="small muted" style={{ padding: '10px 16px' }}>
        Prices are USD per million tokens. Changes apply to new usage only;
        recorded usage keeps the price it was recorded with.
      </div>
    </div>
  );
}

function FieldsRow({ id, name }: { id: string; name: string }) {
  const notify = useStore((s) => s.notify);
  const [status, setStatus] = useState<FieldsStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    try {
      const result = await tryInvoke(
        () => api().invoke('usage:fieldsStatus', id),
        notify,
      );
      if (result) setStatus(result);
    } finally {
      setBusy(false);
    }
  };
  const withFields = status?.types.filter((t) => t.present.length > 0) ?? [];

  return (
    <>
      <div className="list-row">
        <div className="grow">
          <span style={{ fontWeight: 600 }}>{name}</span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label={`Check fields of ${name}`}
          onClick={check}
          disabled={busy}
        >
          Check fields
        </button>
      </div>
      {status && withFields.length > 0 && (
        <div style={{ padding: '10px 16px' }}>
          {withFields.map((t) => (
            <div key={t.type} className="small">
              {`${t.type}: ${t.present.length} of 4 fields${t.missing.length > 0 ? ` (missing ${t.missing.join(', ')})` : ''}`}
            </div>
          ))}
        </div>
      )}
      {status && withFields.length === 0 && (
        <div style={{ padding: '10px 16px' }} className="small">
          <div>No AI cost fields found. To set up the project:</div>
          <ol>
            <li>Create an inherited process from the project process.</li>
            <li>
              Add the fields AI Cost, AI Cost Claude and AI Cost Copilot
              (Decimal) and AI Tokens (Integer) to Issue.
            </li>
            <li>
              Add the same four fields to Task and Epic with &quot;Use an
              existing field&quot;.
            </li>
            <li>Change the project to the inherited process.</li>
          </ol>
          <div>The token needs Work Items: Read &amp; write.</div>
        </div>
      )}
    </>
  );
}

export function CostSection() {
  const connections = useStore((s) => s.connections);
  return (
    <section id="cost" className="section">
      <div className="section-head">
        <h2>AI cost and invoicing</h2>
      </div>
      <InvoicingPart />
      <RatesPart />
      <div className="section-head">
        <h3>Work item fields</h3>
      </div>
      <div className="list">
        {connections.length === 0 && (
          <div className="empty">Add an Azure DevOps connection first.</div>
        )}
        {connections.map((c) => (
          <FieldsRow key={c.id} id={c.id} name={c.name} />
        ))}
      </div>
    </section>
  );
}
