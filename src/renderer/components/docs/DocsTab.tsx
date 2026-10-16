import {
  Code16Regular,
  PanelLeftContract16Regular,
  PanelLeftExpand16Regular,
} from '@fluentui/react-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocFile, TaskView } from '../../../shared/types';
import { api, tryInvoke } from '../../api';
import {
  readDocState,
  readListCollapsed,
  writeDocState,
  writeListCollapsed,
  type DocView,
} from '../../docs/docsPrefs';
import { useStore } from '../../store';
import { track } from '../../telemetry';
import { modKey, Pivots } from '../ui';
import { DocsList, TASK_FILE } from './DocsList';
import { SendTo } from './SendTo';
import { DocsBody, type Doc } from './DocsBody';

type From = 'list' | 'link' | 'terminal';

const errorText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );

/** Targets already acted on, so returning to the tab does not replay an old terminal link. */
const handledTargets = new Map<string, number>();
export const resetDocTargetsForTests = () => handledTargets.clear();

export function DocsTab({ task }: { task: TaskView }) {
  const notify = useStore((s) => s.notify);
  const target = useStore((s) => s.docTarget[task.id]);
  const [files, setFiles] = useState<DocFile[] | null>(null);
  const [filter, setFilter] = useState('');
  const [listCollapsed, setListCollapsed] = useState(readListCollapsed);
  const [current, setCurrent] = useState<string | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [view, setView] = useState<DocView>(() => readDocState(task.id).view);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [updated, setUpdated] = useState(false);
  const [slow, setSlow] = useState(false);
  const [live, setLive] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const token = useRef(0);
  const mtime = useRef<number | null>(null);
  const pending = useRef<{ scroll?: number; anchor?: string }>({});
  const saved = useRef({ path: null as string | null, view, scroll: 0 });
  const timers = useRef<{ hl?: number; chip?: number; save?: number }>({});
  const currentRef = useRef(current);
  currentRef.current = current;
  const docRef = useRef(doc);
  docRef.current = doc;

  const persist = useCallback(() => {
    const s = saved.current;
    writeDocState(task.id, { path: s.path, view: s.view, scroll: s.scroll });
  }, [task.id]);

  const loadFiles = useCallback(async () => {
    try {
      setFiles((await api().invoke('docs:list', task.id)).files);
    } catch (e) {
      notify('error', errorText(e));
      setFiles((f) => f ?? []);
    }
  }, [task.id, notify]);

  /** Reads a document. A first load shows a spinner; a reload keeps the old text until the new arrives. */
  const read = useCallback(
    async (path: string, first: boolean) => {
      const mine = ++token.current;
      let spin: number | undefined;
      if (first) {
        setSlow(false);
        spin = window.setTimeout(() => setSlow(true), 150);
      }
      try {
        const r = await api().invoke('docs:read', task.id, path);
        if (mine !== token.current) return;
        if (path !== currentRef.current) return;
        mtime.current = r.mtimeMs;
        const shown = docRef.current;
        if (
          !first &&
          shown?.path === path &&
          shown.text !== r.text &&
          (scrollRef.current?.scrollTop ?? 0) > 0
        ) {
          setUpdated(true);
          window.clearTimeout(timers.current.chip);
          timers.current.chip = window.setTimeout(
            () => setUpdated(false),
            2000,
          );
        }
        setDoc({ path, text: r.text, error: null, deleted: false });
      } catch (e) {
        if (mine !== token.current || path !== currentRef.current) return;
        const msg = errorText(e);
        setDoc((d) => {
          if (
            msg === 'Not found' &&
            !first &&
            d?.path === path &&
            d.text !== null
          )
            return { ...d, deleted: true };
          if (msg === 'Too large')
            return { path, text: null, error: 'too-large', deleted: false };
          return { path, text: null, error: msg, deleted: false };
        });
      } finally {
        window.clearTimeout(spin);
        if (first) setSlow(false);
      }
    },
    [task.id],
  );

  const openPath = useCallback(
    (
      path: string,
      opts: { from: From; view?: DocView; line?: number; anchor?: string },
    ) => {
      const nextView = opts.view ?? (opts.line ? 'source' : undefined);
      if (nextView) setView(nextView);
      track('docs.opened', {
        view: nextView ?? saved.current.view,
        from: opts.from,
      });
      window.clearTimeout(timers.current.hl);
      if (opts.line) {
        setHighlight(opts.line);
        timers.current.hl = window.setTimeout(() => setHighlight(null), 2000);
      } else setHighlight(null);
      if (path === currentRef.current) {
        scrollToAnchor(scrollRef.current, opts.anchor);
        return;
      }
      pending.current = { anchor: opts.anchor };
      saved.current = { ...saved.current, path, scroll: 0 };
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      setCurrent(path);
    },
    [],
  );

  // File list: on mount and on every change event for this task.
  useEffect(() => {
    void loadFiles();
    return api().on('docs:changed', (p) => {
      if (p.taskId !== task.id) return;
      void loadFiles();
      const open = currentRef.current;
      if (open && p.paths.includes(open)) void read(open, false);
    });
  }, [task.id, loadFiles, read]);

  // Learn whether the watcher is live. Main reference-counts, so each true is paired with a false.
  useEffect(() => {
    let off = false;
    let on = false;
    const sendOff = () =>
      void api()
        .invoke('docs:watch', task.id, false)
        .catch(() => undefined);
    const pendingOn = api()
      .invoke('docs:watch', task.id, true)
      .then(
        (r) => {
          on = true;
          if (!off) setLive(r.live);
          return true;
        },
        () => false,
      );
    return () => {
      off = true;
      // Off only if on succeeded: an unpaired off would decrement another holder's count.
      if (on) sendOff();
      else void pendingOn.then((ok) => ok && sendOff());
    };
  }, [task.id]);

  // A target from a terminal link wins over the remembered file.
  useEffect(() => {
    if (!target || handledTargets.get(task.id) === target.nonce) return;
    handledTargets.set(task.id, target.nonce);
    openPath(target.path, { from: 'terminal', line: target.line });
  }, [target, task.id, openPath]);

  // The first file: remembered, else the task file, README, or the first listed.
  useEffect(() => {
    if (current !== null || !files || files.length === 0) return;
    const remembered = readDocState(task.id);
    const has = (p: string | null) => !!p && files.some((f) => f.path === p);
    const pick = has(remembered.path)
      ? remembered.path!
      : has(TASK_FILE)
        ? TASK_FILE
        : has('README.md')
          ? 'README.md'
          : files[0].path;
    if (pick === remembered.path)
      pending.current = { scroll: remembered.scroll };
    saved.current = {
      ...saved.current,
      path: pick,
      scroll: pick === remembered.path ? remembered.scroll : 0,
    };
    setCurrent(pick);
  }, [files, current, task.id]);

  useEffect(() => {
    if (current === null) return;
    mtime.current = null;
    setDoc(null);
    void read(current, true);
    persist();
  }, [current, read, persist]);

  useEffect(() => {
    saved.current = { ...saved.current, view };
    persist();
  }, [view, persist]);

  // Restore scroll or jump to an anchor once the text has rendered.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !doc || doc.text === null || doc.path !== current) return;
    const p = pending.current;
    if (p.scroll !== undefined) el.scrollTop = p.scroll;
    else if (p.anchor) scrollToAnchor(el, p.anchor);
    pending.current = {};
  }, [doc, current]);

  // Without a live watcher, poll the open file.
  useEffect(() => {
    if (live !== false || !current) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const r = await api().invoke('docs:read', task.id, current);
          if (current !== currentRef.current) return;
          if (mtime.current !== null && r.mtimeMs !== mtime.current)
            void read(current, false);
        } catch {
          if (current === currentRef.current) void read(current, false);
        }
        void loadFiles();
      })();
    }, 2000);
    return () => window.clearInterval(id);
  }, [live, current, task.id, read, loadFiles]);

  useEffect(
    () => () => {
      const t = timers.current;
      window.clearTimeout(t.hl);
      window.clearTimeout(t.chip);
      if (t.save !== undefined) {
        window.clearTimeout(t.save);
        persist();
      }
      token.current++;
    },
    [persist],
  );

  const onScroll = () => {
    saved.current.scroll = scrollRef.current?.scrollTop ?? 0;
    if (timers.current.save !== undefined) return;
    timers.current.save = window.setTimeout(() => {
      timers.current.save = undefined;
      persist();
    }, 300);
  };

  const openInEditor = (path: string, line?: number) =>
    tryInvoke(
      () =>
        line
          ? api().invoke('docs:openInEditor', task.id, path, line)
          : api().invoke('docs:openInEditor', task.id, path),
      notify,
    );

  const collapse = (v: boolean) => {
    setListCollapsed(v);
    writeListCollapsed(v);
  };

  return (
    <div className="docs">
      <DocsList
        files={files ?? []}
        filter={filter}
        onFilter={setFilter}
        current={current}
        hidden={listCollapsed}
        onOpen={(p) => openPath(p, { from: 'list' })}
      />
      <section className="docs-doc">
        <div className="docs-bar">
          <button
            type="button"
            className="btn btn-subtle btn-sm"
            aria-label={listCollapsed ? 'Show file list' : 'Hide file list'}
            title={listCollapsed ? 'Show file list' : 'Hide file list'}
            onClick={() => collapse(!listCollapsed)}
          >
            {listCollapsed ? (
              <PanelLeftExpand16Regular />
            ) : (
              <PanelLeftContract16Regular />
            )}
          </button>
          <span className="docs-crumb mono small muted">
            {(current ?? '').split('/').map((part, i, all) => (
              <span key={i}>
                {part}
                {i < all.length - 1 ? ' / ' : ''}
              </span>
            ))}
          </span>
          <Pivots
            label="View"
            items={[
              { key: 'rendered', label: 'Rendered' },
              { key: 'source', label: 'Source' },
            ]}
            selected={view}
            onSelect={setView}
          />
          <button
            type="button"
            className="btn btn-subtle btn-sm"
            disabled={!current}
            onClick={() =>
              current && void openInEditor(current, highlight ?? undefined)
            }
          >
            <Code16Regular aria-hidden="true" />
            Open in VS Code
          </button>
          <button
            type="button"
            className="btn btn-subtle btn-sm"
            disabled={!current}
            onClick={() =>
              current &&
              void tryInvoke(
                () => api().invoke('docs:reveal', task.id, current),
                notify,
              )
            }
          >
            {modKey === 'Cmd' ? 'Reveal in Finder' : 'Show in Explorer'}
          </button>
        </div>
        {doc?.deleted && (
          <div className="notice warn">This file was deleted.</div>
        )}
        <div
          className="docs-scroll"
          ref={(el) => {
            scrollRef.current = el;
            setScrollEl(el);
          }}
          onScroll={onScroll}
        >
          <DocsBody
            taskId={task.id}
            empty={files !== null && files.length === 0}
            doc={doc}
            current={current}
            slow={slow}
            view={view}
            highlight={highlight}
            onRetry={(path) => void read(path, true)}
            onOpenDoc={(p, anchor) =>
              openPath(p, { from: 'link', view: 'rendered', anchor })
            }
            onOpenFile={(p) => void openInEditor(p)}
          />
          {updated && <span className="docs-updated">Updated</span>}
        </div>
        {doc?.path && doc.text !== null && (
          <SendTo
            task={task}
            container={scrollEl}
            path={doc.path}
            view={view}
          />
        )}
      </section>
    </div>
  );
}

function scrollToAnchor(root: HTMLElement | null, anchor?: string) {
  if (!root || !anchor) return;
  for (const el of root.querySelectorAll('[id]'))
    if (el.id === anchor) {
      el.scrollIntoView?.({ block: 'start' });
      return;
    }
}
