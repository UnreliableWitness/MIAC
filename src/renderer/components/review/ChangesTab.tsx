import { ArrowDown16Regular, ArrowUp16Regular } from '@fluentui/react-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type FileContent,
  isGenerated,
  type ReviewFile,
  type ReviewRepo,
  type ReviewScope,
  viewedKey,
} from '../../../shared/review';
import type { TaskView } from '../../../shared/types';
import { api, tryInvoke } from '../../api';
import {
  readReviewPrefs,
  type ReviewPrefs,
  writeReviewPrefs,
} from '../../review/reviewPrefs';
import { useReview } from '../../review/useReview';
import { useStore } from '../../store';
import { track } from '../../telemetry';
import { OpenInEditor } from '../OpenInEditor';
import { DiffView, type DiffKey, type DiffViewHandle } from './DiffView';
import { FileTree, type FileRef } from './FileTree';
import { ScopePicker } from './ScopePicker';

const kb = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Files in tree order (generated files last), for next/previous file. */
function ordered(
  repos: ReviewRepo[],
): { repo: ReviewRepo; file: ReviewFile }[] {
  return repos.flatMap((r) => {
    const all = r.files.map((file) => ({ repo: r, file }));
    return [
      ...all.filter((x) => !isGenerated(x.file.path, r.collapse)),
      ...all.filter((x) => isGenerated(x.file.path, r.collapse)),
    ];
  });
}

export function ChangesTab({ task }: { task: TaskView }) {
  const notify = useStore((s) => s.notify);
  const [scope, setScope] = useState<ReviewScope>({ kind: 'all' });
  const { files, state, setState, changedAt } = useReview(task, scope, true);
  const [selected, setSelected] = useState<FileRef | null>(null);
  const [content, setContent] = useState<FileContent | null>(null);
  const [prefs, setPrefs] = useState<ReviewPrefs>(() => readReviewPrefs());
  const handle = useRef<DiffViewHandle | null>(null);
  const tracked = useRef(false);

  const list = useMemo(() => (files ? ordered(files.repos) : []), [files]);
  const current =
    list.find(
      (x) =>
        x.repo.workspaceId === selected?.workspaceId &&
        x.file.path === selected.path,
    ) ?? null;

  // Keep the selection while the file is still listed; otherwise open the first file.
  useEffect(() => {
    if (!files) return;
    if (!current)
      setSelected(
        list[0]
          ? { workspaceId: list[0].repo.workspaceId, path: list[0].file.path }
          : null,
      );
  }, [files, current, list]);

  useEffect(() => {
    if (!files || tracked.current) return;
    tracked.current = true;
    track('review.opened', {
      scope: scope.kind,
      files: list.length,
      repos: files.repos.length,
    });
  }, [files, list.length, scope.kind]);

  const fileKey = current
    ? `${current.repo.workspaceId}/${current.file.path}/${current.file.hash}`
    : null;
  useEffect(() => {
    if (!current) {
      setContent(null);
      return;
    }
    let live = true;
    const { path, oldPath, status, binary } = current.file;
    void api()
      .invoke(
        'review:file',
        task.id,
        current.repo.workspaceId,
        { path, ...(oldPath ? { oldPath } : {}), status, binary },
        scope,
      )
      .then((c) => live && setContent(c))
      .catch(() => live && setContent(null));
    return () => {
      live = false;
    };
    // fileKey covers the file and its content hash; changedAt reloads after a watcher event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey, changedAt, task.id, JSON.stringify(scope)]);

  const setPref = (patch: Partial<ReviewPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writeReviewPrefs(next);
  };

  const setViewed = async (repo: ReviewRepo, file: ReviewFile, on: boolean) => {
    const s = await tryInvoke(
      () =>
        api().invoke(
          'review:setViewed',
          task.id,
          viewedKey(repo.workspaceId, file.path),
          on ? file.hash : null,
        ),
      notify,
    );
    if (s) {
      setState(s);
      if (on) track('review.fileViewed');
    }
  };

  const step = (by: number) => {
    if (list.length === 0) return;
    const i = list.findIndex((x) => x === current);
    const next = list[(i + by + list.length) % list.length];
    setSelected({ workspaceId: next.repo.workspaceId, path: next.file.path });
  };
  const onKey = (key: DiffKey) => {
    if (key === 'j') step(1);
    else if (key === 'k') step(-1);
    else if (key === 'n') handle.current?.goToChange('next');
    else if (key === 'p') handle.current?.goToChange('previous');
    else if (key === 'v' && current)
      void setViewed(
        current.repo,
        current.file,
        state?.viewed[
          viewedKey(current.repo.workspaceId, current.file.path)
        ] !== current.file.hash,
      );
  };

  const total = list.length;
  const viewedCount = state
    ? list.filter(
        (x) =>
          state.viewed[viewedKey(x.repo.workspaceId, x.file.path)] ===
          x.file.hash,
      ).length
    : 0;

  const body = () => {
    if (!files) return <div className="review-empty">Loading changes…</div>;
    if (total === 0 && files.repos.every((r) => !r.error))
      return (
        <div className="review-empty">
          {scope.kind === 'uncommitted'
            ? 'Nothing uncommitted.'
            : 'No changes since the task started.'}
        </div>
      );
    if (!current) return null;
    if (!content)
      return <div className="review-empty">Loading {current.file.path}…</div>;
    if (content.binary)
      return (
        <div className="review-empty">{`Binary file, ${kb(content.beforeSize)} → ${kb(content.afterSize)}`}</div>
      );
    if (content.tooLarge)
      return (
        <div className="review-empty">{`Too large to show here (${kb(Math.max(content.beforeSize, content.afterSize))}). Open it in your editor.`}</div>
      );
    return (
      <DiffView
        uriKey={`${current.repo.workspaceId}/${current.file.path}`}
        before={content.before ?? ''}
        after={content.after ?? ''}
        sideBySide={prefs.sideBySide}
        ignoreWhitespace={prefs.ignoreWhitespace}
        hideUnchanged={prefs.hideUnchanged}
        onKey={onKey}
        onReady={(h) => {
          handle.current = h;
        }}
      />
    );
  };

  return (
    <section className="review" aria-label="Changes">
      <div className="review-head">
        <ScopePicker
          scope={scope}
          repos={files?.repos ?? []}
          onChange={(s) => setScope(s)}
        />
        <span className="small muted">{`${viewedCount} / ${total} viewed`}</span>
        <span className="grow" />
        <OpenInEditor
          taskId={task.id}
          workspaceId={current?.repo.workspaceId}
        />
      </div>
      {scope.kind !== 'all' && (
        <div className="review-note small muted">
          Comments are shown in All changes
        </div>
      )}
      <div className="review-body">
        <FileTree
          repos={files?.repos ?? []}
          selected={selected}
          viewed={state?.viewed ?? {}}
          commentCount={() => 0}
          onSelect={setSelected}
          onViewed={(r, f, on) => void setViewed(r, f, on)}
        />
        <div className="review-main">
          {current && (
            <div className="review-toolbar">
              <span className="mono small review-path">
                {current.file.oldPath
                  ? `${current.file.oldPath} → ${current.file.path}`
                  : current.file.path}
              </span>
              <span className="grow" />
              <label className="small">
                <input
                  type="checkbox"
                  checked={prefs.sideBySide}
                  onChange={(e) => setPref({ sideBySide: e.target.checked })}
                />{' '}
                Side by side
              </label>
              <label className="small">
                <input
                  type="checkbox"
                  checked={prefs.ignoreWhitespace}
                  onChange={(e) =>
                    setPref({ ignoreWhitespace: e.target.checked })
                  }
                />{' '}
                Ignore whitespace
              </label>
              <label className="small">
                <input
                  type="checkbox"
                  checked={prefs.hideUnchanged}
                  onChange={(e) => setPref({ hideUnchanged: e.target.checked })}
                />{' '}
                Hide unchanged
              </label>
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                aria-label="Previous change (p)"
                title="Previous change (p)"
                onClick={() => onKey('p')}
              >
                <ArrowUp16Regular />
              </button>
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                aria-label="Next change (n)"
                title="Next change (n)"
                onClick={() => onKey('n')}
              >
                <ArrowDown16Regular />
              </button>
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                title="Previous file (k)"
                onClick={() => onKey('k')}
              >
                Previous file
              </button>
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                title="Next file (j)"
                onClick={() => onKey('j')}
              >
                Next file
              </button>
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                disabled={current.file.status === 'D'}
                onClick={() =>
                  tryInvoke(
                    () =>
                      api().invoke(
                        'editor:openFile',
                        task.id,
                        current.repo.workspaceId,
                        current.file.path,
                        handle.current?.selection()?.startLine,
                      ),
                    notify,
                  )
                }
              >
                Open file in editor
              </button>
            </div>
          )}
          {body()}
        </div>
      </div>
    </section>
  );
}
