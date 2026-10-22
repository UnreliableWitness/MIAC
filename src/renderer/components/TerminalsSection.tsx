import { useEffect, useState } from 'react';
import type { DefaultTerminals } from '../../shared/terminals';
import { api, saveSettings, tryInvoke } from '../api';
import { useStore } from '../store';

const TABS: { key: keyof DefaultTerminals; label: string }[] = [
  { key: 'claude', label: 'Claude Code' },
  { key: 'copilot', label: 'Copilot CLI' },
  { key: 'opencode', label: 'OpenCode' },
  { key: 'shell', label: 'A shell' },
];

/** Settings: the tabs a new task opens (Start uses them as they are; New task pre-ticks them). */
export function TerminalsSection() {
  const notify = useStore((s) => s.notify);
  const [tabs, setTabs] = useState<DefaultTerminals | null>(null);

  useEffect(() => {
    let live = true;
    void tryInvoke(() => api().invoke('settings:get'), notify).then((s) => {
      if (live && s) setTabs(s.defaultTerminals);
    });
    return () => {
      live = false;
    };
  }, [notify]);

  const toggle = async (key: keyof DefaultTerminals, on: boolean) => {
    if (!tabs) return;
    const next = { ...tabs, [key]: on };
    setTabs(next);
    await tryInvoke(() => saveSettings({ defaultTerminals: next }), notify);
  };

  return (
    <section id="terminals" className="section">
      <div className="section-head">
        <h2>Terminals and agents</h2>
      </div>
      <div className="list">
        {tabs && (
          <div className="list-row" style={{ display: 'block' }}>
            <div className="small muted" style={{ marginBottom: 6 }}>
              Tabs a new task opens. Start on the Sprint page and Home uses
              these as they are; New task starts from them.
            </div>
            {TABS.map((t) => (
              <div key={t.key}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={tabs[t.key]}
                    onChange={(e) => void toggle(t.key, e.target.checked)}
                  />{' '}
                  {t.label}
                </label>
              </div>
            ))}
            <div className="small muted" style={{ marginTop: 6 }}>
              Any tab can still be added to a task from its + menu. The shell
              and the agents&rsquo; flags follow the platform defaults.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
