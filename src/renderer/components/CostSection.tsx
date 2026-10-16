import { useEffect, useState } from 'react';
import type {
  AppSettings,
  FieldsStatus,
  Rate,
  ReceiverStatus,
} from '../../shared/usage';
import { OFFICIAL_USD_TO_EUR } from '../../shared/usage';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';

type SettingsDraft = {
  receiverPort: string;
  hourlySync: boolean;
  writeCostToAdo: boolean;
};

/** A number typed in a field, or null when it is blank or not a number (Number('') would be 0). */
const parseNumber = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A price with up to 3 decimals and no trailing zeros. */
const price = (n: number): string => String(Math.round(n * 1000) / 1000);

const tier = (r: Rate): string =>
  [
    r.minInputTokens > 0 ? `from ${r.minInputTokens} input tokens` : '',
    r.fast ? 'fast' : '',
  ]
    .filter(Boolean)
    .join(', ');

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
          receiverPort: String(s.receiverPort),
          hourlySync: s.hourlySync,
          writeCostToAdo: s.writeCostToAdo,
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
    const receiverPort = parseNumber(draft.receiverPort);
    if (receiverPort === null) {
      setError('Usage receiver port must be a number');
      return;
    }
    setError(null);
    // Read fresh so a save from another section is not overwritten.
    const saved = await tryInvoke(async () => {
      const fresh = await api().invoke('settings:get');
      const settings: AppSettings = {
        ...fresh,
        receiverPort,
        hourlySync: draft.hourlySync,
        writeCostToAdo: draft.writeCostToAdo,
      };
      return api().invoke('settings:save', settings);
    }, notify);
    if (saved) notify('info', 'Settings saved');
  };

  return (
    <div className="list">
      {draft && (
        <div className="conn-form">
          <span>Invoice currency</span>
          <span>{`EUR at ${OFFICIAL_USD_TO_EUR} per USD (built in)`}</span>
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
          <div className="cost-write">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.writeCostToAdo}
                onChange={(e) =>
                  setDraft({ ...draft, writeCostToAdo: e.target.checked })
                }
              />
              Write AI cost to Azure DevOps
            </label>
            <span className="small muted">
              The AI cost fields and a usage comment on the work item, and the
              cost line in draft pull requests. Off: the cost stays in MIAC
              (Usage tab, CSV export).
            </span>
          </div>
          <span />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.writeCostToAdo && draft.hourlySync}
              disabled={!draft.writeCostToAdo}
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
  const [rows, setRows] = useState<Rate[]>([]);
  const [officialAsOf, setOfficialAsOf] = useState('');

  useEffect(() => {
    let live = true;
    void tryInvoke(() => api().invoke('rates:list'), notify).then((r) => {
      if (live && r) {
        setRows(r.rates);
        setOfficialAsOf(r.officialAsOf);
      }
    });
    return () => {
      live = false;
    };
  }, [notify]);

  if (!officialAsOf) return null;

  return (
    <div className="list">
      <div className="small muted" style={{ padding: '10px 16px' }}>
        {`Official list prices as of ${officialAsOf} (USD per 1M tokens)`}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="rates">
          <thead>
            <tr>
              <th>Model</th>
              <th>Matches</th>
              <th>Tier</th>
              <th>Input</th>
              <th>Cached input</th>
              <th>Cache write</th>
              <th>Output</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.label}</td>
                <td className="mono">{r.match.join(', ')}</td>
                <td>{tier(r)}</td>
                <td className="mono">{price(r.inputPerM)}</td>
                <td className="mono">{price(r.cachedInputPerM)}</td>
                <td className="mono">{price(r.cacheWritePerM)}</td>
                <td className="mono">{price(r.outputPerM)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
