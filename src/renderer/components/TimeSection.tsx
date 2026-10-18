import { useEffect, useState } from 'react';
import type { AppSettings } from '../../shared/usage';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const minutesOf = (t: string) =>
  Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

type Draft = {
  start: string;
  end: string;
  days: number[];
  idleMinutes: string;
  writeTimeToAdo: boolean;
};

/** Settings: working hours, idle timeout and whether booked time goes to Azure DevOps. */
export function TimeSection() {
  const notify = useStore((s) => s.notify);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void tryInvoke(() => api().invoke('settings:get'), notify).then((s) => {
      if (live && s)
        setDraft({
          start: s.workHours.start,
          end: s.workHours.end,
          days: s.workHours.days,
          idleMinutes: String(s.idleMinutes),
          writeTimeToAdo: s.writeTimeToAdo,
        });
    });
    return () => {
      live = false;
    };
  }, [notify]);

  const save = async () => {
    if (!draft) return;
    const idle = Number(draft.idleMinutes);
    if (!/^\d+$/.test(draft.idleMinutes.trim()) || idle < 1 || idle > 60) {
      setError('Idle minutes must be a whole number from 1 to 60');
      return;
    }
    if (
      !draft.start ||
      !draft.end ||
      minutesOf(draft.end) <= minutesOf(draft.start)
    ) {
      setError('Working hours must end after they start');
      return;
    }
    setError(null);
    // Read fresh so a save from another section is not overwritten.
    const saved = await tryInvoke(async () => {
      const fresh = await api().invoke('settings:get');
      const settings: AppSettings = {
        ...fresh,
        idleMinutes: idle,
        writeTimeToAdo: draft.writeTimeToAdo,
        workHours: {
          start: draft.start,
          end: draft.end,
          days: [...draft.days].sort(),
        },
      };
      return api().invoke('settings:save', settings);
    }, notify);
    if (saved) notify('info', 'Settings saved');
  };

  return (
    <section id="time" className="section">
      <div className="section-head">
        <h2>Time tracking</h2>
      </div>
      <div className="list">
        {draft && (
          <div className="conn-form">
            <label htmlFor="time-start">Working hours start</label>
            <input
              id="time-start"
              className="field mono"
              type="time"
              value={draft.start}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            />
            <label htmlFor="time-end">Working hours end</label>
            <input
              id="time-end"
              className="field mono"
              type="time"
              value={draft.end}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            />
            <span>Working days</span>
            <div>
              {DAYS.map((d, i) => (
                <label key={d} className="checkbox">
                  <input
                    type="checkbox"
                    checked={draft.days.includes(i)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        days: e.target.checked
                          ? [...draft.days, i]
                          : draft.days.filter((x) => x !== i),
                      })
                    }
                  />
                  {d}
                </label>
              ))}
            </div>
            <label htmlFor="time-idle">Idle minutes</label>
            <input
              id="time-idle"
              className="field mono"
              type="number"
              min={1}
              max={60}
              value={draft.idleMinutes}
              onChange={(e) =>
                setDraft({ ...draft, idleMinutes: e.target.value })
              }
            />
            <span />
            <div className="cost-write">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.writeTimeToAdo}
                  onChange={(e) =>
                    setDraft({ ...draft, writeTimeToAdo: e.target.checked })
                  }
                />
                Write booked time to Azure DevOps (adds to Completed Work,
                lowers Remaining Work)
              </label>
              <span className="small muted">
                Off: the time stays in Shellie (Usage tab, CSV export).
              </span>
            </div>
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
