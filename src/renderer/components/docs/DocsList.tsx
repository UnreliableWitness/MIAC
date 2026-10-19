import {
  ChevronDown12Regular,
  ChevronRight12Regular,
} from '@fluentui/react-icons';
import { useState } from 'react';
import type { DocFile, SessionDoc } from '../../../shared/types';
import type { DocsMode } from '../../docs/docsPrefs';
import type { TreeFolder, TreeNode } from '../../docs/docTree';
import { Pivots } from '../ui';

export const TASK_FILE = '.shellie/task.md';

const dirOf = (p: string) =>
  p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

function Entry({
  file,
  label,
  current,
  onOpen,
  depth,
}: {
  file: DocFile;
  label: string;
  current: string | null | boolean;
  onOpen(path: string): void;
  depth?: number;
}) {
  const on = typeof current === 'boolean' ? current : current === file.path;
  return (
    <button
      type="button"
      className={`docs-file${on ? ' is-current' : ''}`}
      title={file.path}
      style={depth !== undefined ? { paddingLeft: 8 + depth * 12 } : undefined}
      onClick={() => onOpen(file.path)}
    >
      <span className="docs-file-name">{label}</span>
      {file.changed && (
        <span className={`docs-badge docs-badge-${file.changed}`}>
          {file.changed}
        </span>
      )}
    </button>
  );
}

const MODES: { key: DocsMode; label: string }[] = [
  { key: 'session', label: 'Session' },
  { key: 'all', label: 'All docs' },
];

/** The session docs as a tree: roots and folders fold, files open. */
function SessionTree({
  tree,
  isCurrent,
  onOpen,
}: {
  tree: TreeFolder[];
  isCurrent(doc: SessionDoc): boolean;
  onOpen(doc: SessionDoc): void;
}) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const render = (n: TreeNode, depth: number) =>
    n.kind === 'file' ? (
      <Entry
        key={n.key}
        file={n.doc}
        label={n.name}
        current={isCurrent(n.doc)}
        depth={depth}
        onOpen={() => onOpen(n.doc)}
      />
    ) : (
      <div key={n.key} role="group" aria-label={n.name} className="docs-group">
        <button
          type="button"
          className={`docs-folder docs-tree-folder small${n.root ? ' is-root' : ' muted'}`}
          style={{ paddingLeft: 4 + depth * 12 }}
          aria-expanded={!folded.has(n.key)}
          title={n.name}
          onClick={() => toggle(n.key)}
        >
          {folded.has(n.key) ? (
            <ChevronRight12Regular aria-hidden="true" />
          ) : (
            <ChevronDown12Regular aria-hidden="true" />
          )}
          {n.root && n.key.startsWith('dir:') ? (
            // A long absolute folder keeps its end (the folder's own name) in view.
            <span className="docs-file-name docs-root-path">
              <bdo dir="ltr">{n.name}</bdo>
            </span>
          ) : (
            <span className="docs-file-name">{n.name}</span>
          )}
        </button>
        {!folded.has(n.key) && n.children.map((c) => render(c, depth + 1))}
      </div>
    );
  return <div className="docs-tree">{tree.map((r) => render(r, 0))}</div>;
}

/** The file list: the Session / All docs switch, a filter, then the session tree or the worktree's docs. */
export function DocsList({
  files,
  filter,
  onFilter,
  current,
  onOpen,
  hidden,
  mode,
  onMode,
  tree,
  sessionLoaded,
  isCurrent,
  onOpenSession,
}: {
  files: DocFile[];
  filter: string;
  onFilter(v: string): void;
  current: string | null;
  onOpen(path: string): void;
  hidden: boolean;
  mode: DocsMode;
  onMode(m: DocsMode): void;
  /** The session docs, already filtered. */
  tree: TreeFolder[];
  sessionLoaded: boolean;
  isCurrent(doc: SessionDoc): boolean;
  onOpenSession(doc: SessionDoc): void;
}) {
  return (
    <aside className="docs-list" hidden={hidden} aria-label="Files">
      <div className="docs-mode">
        <Pivots label="Show" items={MODES} selected={mode} onSelect={onMode} />
      </div>
      <input
        className="input docs-filter"
        placeholder="Filter"
        aria-label="Filter files"
        value={filter}
        onChange={(e) => onFilter(e.target.value)}
      />
      {mode === 'session' ? (
        sessionLoaded && tree.length === 0 ? (
          <p className="docs-list-empty muted small">
            {filter.trim()
              ? 'No session docs match the filter.'
              : 'Docs Claude edits or creates in this task, and Markdown changed in its worktrees, show up here.'}
          </p>
        ) : (
          <SessionTree
            tree={tree}
            isCurrent={isCurrent}
            onOpen={onOpenSession}
          />
        )
      ) : (
        <AllDocs
          files={files}
          filter={filter}
          current={current}
          onOpen={onOpen}
        />
      )}
    </aside>
  );
}

/** Every doc of the worktree: the pinned Task file, then folder groups. */
function AllDocs({
  files,
  filter,
  current,
  onOpen,
}: {
  files: DocFile[];
  filter: string;
  current: string | null;
  onOpen(path: string): void;
}) {
  const q = filter.trim().toLowerCase();
  const shown = files.filter((f) => !q || f.path.toLowerCase().includes(q));
  const task = shown.find((f) => f.path === TASK_FILE);
  const groups = new Map<string, DocFile[]>();
  for (const f of shown) {
    if (f.path === TASK_FILE) continue;
    const dir = dirOf(f.path);
    groups.set(dir, [...(groups.get(dir) ?? []), f]);
  }
  const dirs = [...groups.keys()].sort((a, b) =>
    a === '' ? -1 : b === '' ? 1 : a.localeCompare(b),
  );
  return (
    <>
      {task && (
        <Entry file={task} label="Task" current={current} onOpen={onOpen} />
      )}
      {dirs.map((dir) => (
        <div key={dir} className="docs-group">
          {dir && <div className="docs-folder muted small">{dir}</div>}
          {groups.get(dir)!.map((f) => (
            <Entry
              key={f.path}
              file={f}
              label={nameOf(f.path)}
              current={current}
              onOpen={onOpen}
            />
          ))}
        </div>
      ))}
    </>
  );
}
