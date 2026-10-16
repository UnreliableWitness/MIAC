import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';
import { createLinkProvider } from '../terminalLinks';
import { registerTerminal } from '../terminalRegistry';
import { loadRenderer, terminalOptions, windowsBuild } from '../terminalSetup';

export function TerminalView({
  terminalId,
  taskId,
  active,
  resumes = false,
  autoStart = false,
}: {
  terminalId: string;
  taskId: string;
  active: boolean;
  /** Claude Code: Restart resumes the conversation, so the button says so. */
  resumes?: boolean;
  /** Started again by itself when first shown after an app relaunch (its process is gone, not exited). */
  autoStart?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const notify = useStore((s) => s.notify);
  const [exitCode, setExitCode] = useState<number | null>(null);
  /** Main has no process for this terminal: the app was relaunched (or updated) since it started. */
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const t = new Terminal(terminalOptions(null));
    const f = new FitAddon();
    t.loadAddon(f);
    term.current = t;
    const unregister = registerTerminal(terminalId, t);
    fit.current = f;
    let live = true;
    let links: { dispose(): void } | null = null;

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
    void api()
      .invoke('terminals:buffer', terminalId)
      .catch(() => {
        // Only a terminal main does not know has no buffer.
        if (live) setGone(true);
        return '';
      })
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
    // Open once the ConPTY build is known. Output written before that is buffered by xterm.
    void windowsBuild().then((build) => {
      if (!live) return;
      if (build) t.options.windowsPty = terminalOptions(build).windowsPty;
      t.open(el);
      loadRenderer(t);
      links = t.registerLinkProvider(createLinkProvider(t, taskId));
      observer.observe(el);
      sendSize();
    });

    return () => {
      live = false;
      observer.disconnect();
      onData.dispose();
      links?.dispose();
      offData();
      offExit();
      unregister();
      t.dispose();
      term.current = null;
    };
  }, [terminalId, taskId]);

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
  useEffect(() => {
    if (!active || !gone || !autoStart) return;
    setGone(false);
    void restart();
    // restart is recreated each render; this runs once per relaunch, when the tab is first shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, gone, autoStart]);
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
            {resumes ? 'Resume session' : 'Restart'}
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
