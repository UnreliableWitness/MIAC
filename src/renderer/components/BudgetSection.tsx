import { useEffect, useState } from 'react';
import type { BudgetSettings } from '../../shared/budget';
import { api, saveSettings, tryInvoke } from '../api';
import { useStore } from '../store';

type Draft = {
  monthlyEur: string;
  monthStartDay: string;
  alerts: BudgetSettings['alerts'];
};

/** Settings: the company's monthly Claude budget, its reset day and which warnings to show. */
export function BudgetSection() {
  const notify = useStore((s) => s.notify);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void tryInvoke(() => api().invoke('settings:get'), notify).then((s) => {
      if (!live || !s) return;
      const b = s.claudeBudget;
      setDraft({
        monthlyEur: b.monthlyEur === null ? '' : String(b.monthlyEur),
        monthStartDay: String(b.monthStartDay),
        alerts: b.alerts,
      });
    });
    return () => {
      live = false;
    };
  }, [notify]);

  const save = async () => {
    if (!draft) return;
    const raw = draft.monthlyEur.trim();
    const monthlyEur = raw === '' ? null : Number(raw);
    if (
      monthlyEur !== null &&
      !(Number.isFinite(monthlyEur) && monthlyEur > 0)
    ) {
      setError('The budget must be a positive amount, or empty for none.');
      return;
    }
    const day = Number(draft.monthStartDay);
    if (!/^\d+$/.test(draft.monthStartDay.trim()) || day < 1 || day > 28) {
      setError('Month start day must be 1 to 28.');
      return;
    }
    setError(null);
    const saved = await tryInvoke(
      () =>
        saveSettings({
          claudeBudget: {
            monthlyEur,
            monthStartDay: day,
            alerts: draft.alerts,
          },
        }),
      notify,
    );
    if (saved) notify('info', 'Settings saved');
  };

  const alertBox = (key: keyof Draft['alerts'], label: string) =>
    draft && (
      <label className="checkbox">
        <input
          type="checkbox"
          checked={draft.alerts[key]}
          onChange={(e) =>
            setDraft({
              ...draft,
              alerts: { ...draft.alerts, [key]: e.target.checked },
            })
          }
        />
        {label}
      </label>
    );

  return (
    <section id="claude-budget" className="section">
      <div className="section-head">
        <h2>Claude budget</h2>
      </div>
      <div className="list">
        {draft && (
          <div className="conn-form">
            <label htmlFor="budget-eur">Monthly budget (€)</label>
            <input
              id="budget-eur"
              className="field mono"
              type="number"
              min={1}
              step="any"
              placeholder="No budget"
              value={draft.monthlyEur}
              onChange={(e) =>
                setDraft({ ...draft, monthlyEur: e.target.value })
              }
            />
            <label htmlFor="budget-day">Month starts on day</label>
            <input
              id="budget-day"
              className="field mono"
              type="number"
              min={1}
              max={28}
              value={draft.monthStartDay}
              onChange={(e) =>
                setDraft({ ...draft, monthStartDay: e.target.value })
              }
            />
            <span>Warnings</span>
            <div>
              {alertBox('at80', 'Warn at 80% of the budget')}
              {alertBox('forecastOver', 'Warn when the forecast goes over')}
              {alertBox('at100', 'Warn when the budget is used up')}
            </div>
            <span />
            <span className="small muted">
              Your monthly Claude budget from your company. Home shows the spend
              of Claude Code and OpenCode (Anthropic) on this computer against
              it.
            </span>
            <div className="actions">
              <button type="button" className="btn btn-primary" onClick={save}>
                Save
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
      </div>
    </section>
  );
}
