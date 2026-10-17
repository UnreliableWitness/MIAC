import { ArrowDown16Regular, ArrowUp16Regular } from '@fluentui/react-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type FileContent,
  isGenerated,
  type ReviewComment,
  type ReviewFile,
  type ReviewRepo,
  type ReviewScope,
  type ReviewSide,
  type ReviewState,
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
import { CommentBox, CommentCard } from './CommentCard';
import { CommentsList } from './CommentsList';
import {
  DiffView,
  type DiffKey,
  type DiffViewHandle,
  type DiffZone,
} from './DiffView';
import { FileTree, type FileRef } from './FileTree';
import { ScopePicker } from './ScopePicker';
import { SendComments } from './SendComments';

/** A comment being written; its text lives here so a rebuilt diff zone does not lose it. */
type Draft = {
  workspaceId: string;
  path: string;
  side: ReviewSide;
  startLine: number;
  endLine: number;
  text: string;
};

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
  // The content with the file and scope it was read for, so another file's text is never shown.
  const [loaded, setLoaded] = useState<{
    key: string;
    content: FileContent | null;
  } | null>(null);
  const [prefs, setPrefs] = useState<ReviewPrefs>(() => readReviewPrefs());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [panel, setPanel] = useState<'files' | 'comments'>('files');
  // A save of the draft is on its way: a second submit is ignored.
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // The line to scroll to, for the file it belongs to.
  const [reveal, setReveal] = useState<
    (FileRef & { side: ReviewSide; line: number; seq: number }) | undefined
  >();
  const repos = useStore((s) => s.repos);
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
  const scopeKey = JSON.stringify(scope);
  const showKey = current
    ? `${current.repo.workspaceId}/${current.file.path}|${scopeKey}`
    : null;
  const content = loaded && loaded.key === showKey ? loaded.content : null;
  useEffect(() => {
    if (!current || !showKey) {
      setLoaded(null);
      return;
    }
    let live = true;
    const key = showKey;
    const { path, oldPath, status, binary } = current.file;
    void api()
      .invoke(
        'review:file',
        task.id,
        current.repo.workspaceId,
        { path, ...(oldPath ? { oldPath } : {}), status, binary },
        scope,
      )
      .then((c) => live && setLoaded({ key, content: c }))
      .catch(() => live && setLoaded({ key, content: null }));
    return () => {
      live = false;
    };
    // fileKey covers the file and its content hash; changedAt reloads after a watcher event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey, changedAt, task.id, scopeKey]);

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

  const canComment = scope.kind === 'all';
  const comments = state?.comments ?? [];
  const onThisFile = (c: { workspaceId: string; path: string }) =>
    current !== null &&
    c.workspaceId === current.repo.workspaceId &&
    c.path === current.file.path;
  const startDraft = (
    side: ReviewSide,
    startLine: number,
    endLine = startLine,
  ) => {
    if (!canComment || !current) return;
    // A draft with text is never thrown away by another + or c.
    if (draft?.text.trim()) {
      notify('info', 'Finish or cancel the open comment first');
      return;
    }
    setDraft({
      workspaceId: current.repo.workspaceId,
      path: current.file.path,
      side,
      startLine,
      endLine,
      text: '',
    });
  };
  const apply = async (run: () => Promise<ReviewState>) => {
    const s = await tryInvoke(run, notify);
    if (s) setState(s);
    return s;
  };
  const saveDraft = async (text: string) => {
    if (!draft || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const { text: _typed, ...where } = draft;
    try {
      if (
        await apply(() =>
          api().invoke('review:addComment', task.id, { ...where, text }),
        )
      )
        setDraft(null);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const resolve = (c: ReviewComment) => {
    track('review.commentResolved', { outdated: c.status === 'outdated' });
    void apply(() =>
      api().invoke('review:updateComment', task.id, c.id, {
        status: 'resolved',
      }),
    );
  };
  const card = (c: ReviewComment) => (
    <CommentCard
      comment={c}
      onEdit={(text) =>
        void apply(() =>
          api().invoke('review:updateComment', task.id, c.id, { text }),
        )
      }
      onResolve={() => resolve(c)}
      onReopen={() =>
        void apply(() =>
          api().invoke('review:updateComment', task.id, c.id, {
            status: 'open',
          }),
        )
      }
      onDelete={() =>
        void apply(() => api().invoke('review:deleteComment', task.id, c.id))
      }
    />
  );
  const zones: DiffZone[] = canComment
    ? [
        ...comments
          .filter(
            (c) =>
              onThisFile(c) && (c.status === 'open' || c.status === 'sent'),
          )
          .map((c) => ({
            id: c.id,
            side: c.side,
            afterLine: c.endLine,
            node: card(c),
          })),
        ...(draft && onThisFile(draft)
          ? [
              {
                id: 'draft',
                side: draft.side,
                afterLine: draft.endLine,
                node: (
                  <CommentBox
                    value={draft.text}
                    busy={saving}
                    onChange={(text) =>
                      setDraft((d) => (d ? { ...d, text } : d))
                    }
                    onSave={(t) => void saveDraft(t)}
                    onCancel={() => setDraft(null)}
                  />
                ),
              },
            ]
          : []),
      ]
    : [];
  const outdatedHere = canComment
    ? comments.filter((c) => onThisFile(c) && c.status === 'outdated')
    : [];
  const openComment = (c: ReviewComment) => {
    setScope({ kind: 'all' });
    setPanel('files');
    setSelected({ workspaceId: c.workspaceId, path: c.path });
    setReveal({
      workspaceId: c.workspaceId,
      path: c.path,
      side: c.side,
      line: c.startLine,
      seq: Date.now(),
    });
  };
  const unresolved = comments.filter((c) => c.status !== 'resolved').length;
  const revealHere = reveal && onThisFile(reveal) ? reveal : undefined;
  // A file the user picks drops a pending reveal, so it never fires on a later visit.
  const pick = (ref: FileRef) => {
    setReveal(undefined);
    setSelected(ref);
  };

  const step = (by: number) => {
    if (list.length === 0) return;
    const i = list.findIndex((x) => x === current);
    const next = list[(i + by + list.length) % list.length];
    pick({ workspaceId: next.repo.workspaceId, path: next.file.path });
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
    else if (key === 'c') {
      const s = handle.current?.selection();
      if (s) startDraft(s.side, s.startLine, s.endLine);
    }
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
        zones={zones}
        onGlyph={
          canComment ? (side, line) => startDraft(side, line) : undefined
        }
        reveal={
          revealHere
            ? {
                side: revealHere.side,
                line: revealHere.line,
                seq: revealHere.seq,
              }
            : undefined
        }
        onRevealed={() => setReveal(undefined)}
        onReady={(h) => {
          handle.current = h;
        }}
      />
    );
  };

  return (
    <section
      className="review"
      aria-label="Changes"
      tabIndex={-1}
      onKeyDown={(e) => {
        const t = e.target as HTMLElement;
        if (
          e.metaKey ||
          e.ctrlKey ||
          e.altKey ||
          t.closest('input, textarea, select, .monaco-editor, [role="menu"]')
        )
          return;
        if (['j', 'k', 'n', 'p', 'v', 'c'].includes(e.key)) {
          e.preventDefault();
          onKey(e.key as DiffKey);
        }
      }}
    >
      <div className="review-head">
        <ScopePicker
          scope={scope}
          repos={files?.repos ?? []}
          onChange={(s) => setScope(s)}
        />
        <span className="small muted">{`${viewedCount} / ${total} viewed`}</span>
        <span className="small muted">{`${unresolved} open comments`}</span>
        <span className="grow" />
        <SendComments
          task={task}
          comments={comments}
          multiRepo={(files?.repos.length ?? 0) > 1}
          repoName={(id) =>
            files?.repos.find((r) => r.workspaceId === id)?.name ?? id
          }
          onSent={setState}
        />
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
        <div className="review-side">
          <div
            role="tablist"
            aria-label="Review lists"
            className="review-side-tabs"
          >
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'files'}
              className="pivot"
              onClick={() => setPanel('files')}
            >
              Files
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={panel === 'comments'}
              className="pivot"
              onClick={() => setPanel('comments')}
            >
              {`Comments (${comments.length})`}
            </button>
          </div>
          {panel === 'files' ? (
            <FileTree
              repos={files?.repos ?? []}
              selected={selected}
              viewed={state?.viewed ?? {}}
              commentCount={(ref) =>
                comments.filter(
                  (c) =>
                    c.workspaceId === ref.workspaceId &&
                    c.path === ref.path &&
                    c.status !== 'resolved',
                ).length
              }
              onSelect={pick}
              onViewed={(r, f, on) => void setViewed(r, f, on)}
            />
          ) : (
            <CommentsList
              comments={comments}
              multiRepo={(files?.repos.length ?? 0) > 1}
              repoName={(id) =>
                files?.repos.find((r) => r.workspaceId === id)?.name ??
                repos.find((r) => r.id === id)?.name ??
                id
              }
              onOpen={openComment}
            />
          )}
        </div>
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
          {outdatedHere.length > 0 && (
            <div className="review-outdated" aria-label="Outdated comments">
              {outdatedHere.map((c) => (
                <div key={c.id}>{card(c)}</div>
              ))}
            </div>
          )}
          {body()}
        </div>
      </div>
    </section>
  );
}
