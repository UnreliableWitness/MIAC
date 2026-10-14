import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';

const THEME = {
  background: '#0f1113',
  foreground: '#e7e6e2',
  cursor: '#f0a443',
  selectionBackground: '#2a2e35',
};

export function TerminalView({
  terminalId,
  active,
}: {
  terminalId: string;
  active: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const notify = useStore((s) => s.notify);
  const [exitCode, setExitCode] = useState<number | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const t = new Terminal({
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: 13,
      theme: THEME,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(el);
    term.current = t;
    fit.current = f;

    const sendSize = () => {
      try {
        f.fit();
        void api().invoke('terminals:resize', terminalId, t.cols, t.rows);
      } catch {
        /* hidden tab: no size yet */
      }
    };
    // Live chunks are queued until the buffer snapshot is written, so output is
    // neither lost nor duplicated. Chunks that arrived before main took the
    // snapshot are already in the buffer: skip the longest queued prefix that
    // the buffer ends with.
    let replayed = false;
    const queued: string[] = [];
    const offData = api().on('terminal:data', (e) => {
      if (e.id !== terminalId) return;
      if (replayed) t.write(e.data);
      else queued.push(e.data);
    });
    const offExit = api().on('terminal:exit', (e) => {
      if (e.id === terminalId) setExitCode(e.exitCode);
    });
    let live = true;
    void api()
      .invoke('terminals:buffer', terminalId)
      .catch(() => '')
      .then((buf) => {
        if (!live) return;
        const snapshot = buf ?? '';
        if (snapshot) t.write(snapshot);
        let skip = 0;
        let joined = '';
        for (let k = 1; k <= queued.length; k++) {
          joined += queued[k - 1];
          if (snapshot.endsWith(joined)) skip = k;
        }
        for (const chunk of queued.slice(skip)) t.write(chunk);
        queued.length = 0;
        replayed = true;
        return api().invoke('terminals:isRunning', terminalId);
      })
      .then((running) => {
        if (live && running === false) setExitCode((c) => c ?? -1);
      })
      .catch(() => undefined);
    const onData = t.onData((data) => {
      void api().invoke('terminals:write', terminalId, data);
    });
    const observer = new ResizeObserver(() => {
      if (el.offsetParent !== null) sendSize();
    });
    observer.observe(el);
    sendSize();

    return () => {
      live = false;
      observer.disconnect();
      onData.dispose();
      offData();
      offExit();
      t.dispose();
      term.current = null;
    };
  }, [terminalId]);

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        try {
          fit.current?.fit();
          if (term.current)
            void api().invoke(
              'terminals:resize',
              terminalId,
              term.current.cols,
              term.current.rows,
            );
          term.current?.focus();
        } catch {
          /* ignore */
        }
      });
    }
  }, [active, terminalId]);

  const restart = async () => {
    // Reset first so a fast exit of the new process is not wiped afterwards.
    const previous = exitCode;
    term.current?.reset();
    setExitCode(null);
    const ok = await tryInvoke(async () => {
      await api().invoke('terminals:restart', terminalId);
      return true;
    }, notify);
    if (!ok) setExitCode((c) => c ?? previous);
  };
  const close = () =>
    tryInvoke(() => api().invoke('terminals:kill', terminalId), notify);

  return (
    <div className="termview" hidden={!active}>
      <div ref={host} style={{ width: '100%', height: '100%' }} />
      {exitCode !== null && (
        <div className="term-exit" role="status">
          <span>
            {exitCode === -1 ? 'Process ended' : `Exited with code ${exitCode}`}
          </span>
          <button type="button" className="btn btn-sm" onClick={restart}>
            Restart
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={close}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
