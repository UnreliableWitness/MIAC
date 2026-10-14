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
    void api()
      .invoke('terminals:buffer', terminalId)
      .then((buf) => {
        if (buf) t.write(buf);
      });
    void api()
      .invoke('terminals:isRunning', terminalId)
      .then((running) => {
        if (!running) setExitCode((c) => c ?? -1);
      });
    const offData = api().on('terminal:data', (e) => {
      if (e.id === terminalId) t.write(e.data);
    });
    const offExit = api().on('terminal:exit', (e) => {
      if (e.id === terminalId) setExitCode(e.exitCode);
    });
    const onData = t.onData((data) => {
      void api().invoke('terminals:write', terminalId, data);
    });
    const observer = new ResizeObserver(() => {
      if (el.offsetParent !== null) sendSize();
    });
    observer.observe(el);
    sendSize();

    return () => {
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
    const ok = await tryInvoke(async () => {
      await api().invoke('terminals:restart', terminalId);
      return true;
    }, notify);
    if (ok) {
      term.current?.reset();
      setExitCode(null);
    }
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
