import {
  ChevronDown12Regular,
  ChevronRight12Regular,
} from '@fluentui/react-icons';
import { type ReactNode, useState } from 'react';
import {
  isGenerated,
  type ReviewFile,
  type ReviewRepo,
  viewedKey,
} from '../../../shared/review';
import {
  buildTree,
  dirKey,
  treeFiles,
  type TreeDir,
} from '../../review/fileTree';

export type FileRef = { workspaceId: string; path: string };
const STATUS_LABEL = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
} as const;
const split = (p: string) => {
  const i = p.lastIndexOf('/');
  return i < 0
    ? { dir: '', name: p }
    : { dir: p.slice(0, i + 1), name: p.slice(i + 1) };
};

const indent = (depth: number) => ({ paddingLeft: 12 + depth * 14 });

function Row({
  file,
  depth,
  selected,
  viewedHash,
  comments,
  onSelect,
  onViewed,
}: {
  file: ReviewFile;
  /** Set in the tree: the folder depth to indent by, and no folder after the name. */
  depth?: number;
  selected: boolean;
  viewedHash: string | undefined;
  comments: number;
  onSelect: () => void;
  onViewed: (on: boolean) => void;
}) {
  const { dir, name } = split(file.path);
  const viewed = viewedHash === file.hash;
  const changedSince = viewedHash !== undefined && !viewed;
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      className={`review-file${selected ? ' selected' : ''}`}
      style={depth === undefined ? undefined : indent(depth)}
      onClick={onSelect}
    >
      <span
        className={`review-status review-status-${file.status}`}
        title={STATUS_LABEL[file.status]}
      >
        {file.status}
      </span>
      <span
        className="review-name"
        title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      >
        <span>{name}</span>
        {dir && depth === undefined && (
          <span className="muted small"> {dir}</span>
        )}
        {changedSince && (
          <span className="tag tag-warn review-changed">
            Changed since viewed
          </span>
        )}
      </span>
      {comments > 0 && (
        <span
          className="small review-count"
          aria-label={`${comments} ${comments === 1 ? 'comment' : 'comments'}`}
        >
          {comments}
        </span>
      )}
      <span className="small mono review-stat">
        {file.binary ? (
          'bin'
        ) : (
          <>
            <span className="review-plus">+{file.added}</span>{' '}
            <span className="review-minus">−{file.removed}</span>
          </>
        )}
      </span>
      <input
        type="checkbox"
        aria-label={`Viewed ${file.path}`}
        checked={viewed}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onViewed(e.target.checked)}
      />
    </div>
  );
}

/** A folder row and, unless folded, what it holds. */
function Dir({
  dir,
  depth,
  workspaceId,
  collapsed,
  viewedCount,
  comments,
  onToggle,
  row,
}: {
  dir: TreeDir;
  depth: number;
  workspaceId: string;
  collapsed: string[];
  viewedCount: (files: ReviewFile[]) => number;
  comments: (files: ReviewFile[]) => number;
  onToggle: (key: string) => void;
  row: (f: ReviewFile, depth: number) => ReactNode;
}) {
  const key = dirKey(workspaceId, dir.path);
  const expanded = !collapsed.includes(key);
  const all = treeFiles(dir);
  const seen = viewedCount(all);
  const notes = comments(all);
  return (
    <div role="group" aria-label={dir.path}>
      <div
        role="treeitem"
        aria-expanded={expanded}
        aria-selected={false}
        className="review-dir"
        style={indent(depth)}
        title={dir.path}
        onClick={() => onToggle(key)}
      >
        {expanded ? (
          <ChevronDown12Regular aria-hidden="true" />
        ) : (
          <ChevronRight12Regular aria-hidden="true" />
        )}
        <span className="review-name">{dir.name}</span>
        {notes > 0 && (
          <span
            className="small review-count"
            aria-label={`${notes} ${notes === 1 ? 'comment' : 'comments'} in ${dir.path}`}
          >
            {notes}
          </span>
        )}
        <span
          className="small muted mono"
          aria-label={`${seen} of ${all.length} viewed`}
        >
          {`${seen}/${all.length}`}
        </span>
      </div>
      {expanded && (
        <Level
          dir={dir}
          depth={depth + 1}
          workspaceId={workspaceId}
          collapsed={collapsed}
          viewedCount={viewedCount}
          comments={comments}
          onToggle={onToggle}
          row={row}
        />
      )}
    </div>
  );
}

/** A folder's subfolders, then its files. */
function Level(props: Parameters<typeof Dir>[0]) {
  const { dir, depth, row } = props;
  return (
    <>
      {dir.dirs.map((d) => (
        <Dir key={d.path} {...props} dir={d} depth={depth} />
      ))}
      {dir.files.map((f) => row(f, depth))}
    </>
  );
}

/** Changed files per repo, as a folder tree or a flat list; generated files (lock files, dist, the repo's review.collapse) folded away. */
export function FileTree({
  repos,
  view,
  selected,
  viewed,
  collapsed,
  commentCount,
  onSelect,
  onViewed,
  onToggleDir,
}: {
  repos: ReviewRepo[];
  view: 'tree' | 'list';
  selected: FileRef | null;
  viewed: Record<string, string>;
  /** Folded folders, as `dirKey` keys. */
  collapsed: string[];
  commentCount: (ref: FileRef) => number;
  onSelect: (ref: FileRef) => void;
  onViewed: (repo: ReviewRepo, file: ReviewFile, on: boolean) => void;
  onToggleDir: (key: string) => void;
}) {
  const [openGenerated, setOpenGenerated] = useState<Record<string, boolean>>(
    {},
  );
  const grouped = repos.length > 1;
  return (
    <div role="tree" aria-label="Changed files" className="review-tree">
      {repos.map((r) => {
        const normal = r.files.filter((f) => !isGenerated(f.path, r.collapse));
        const generated = r.files.filter((f) =>
          isGenerated(f.path, r.collapse),
        );
        const ref = (f: ReviewFile) => ({
          workspaceId: r.workspaceId,
          path: f.path,
        });
        const row = (f: ReviewFile, depth?: number) => (
          <Row
            key={f.path}
            file={f}
            depth={depth}
            selected={
              selected?.workspaceId === r.workspaceId &&
              selected.path === f.path
            }
            viewedHash={viewed[viewedKey(r.workspaceId, f.path)]}
            comments={commentCount(ref(f))}
            onSelect={() => onSelect(ref(f))}
            onViewed={(on) => onViewed(r, f, on)}
          />
        );
        const files = (list: ReviewFile[]) =>
          view === 'list' ? (
            list.map((f) => row(f))
          ) : (
            <Level
              dir={buildTree(list)}
              depth={0}
              workspaceId={r.workspaceId}
              collapsed={collapsed}
              viewedCount={(fs) =>
                fs.filter(
                  (f) => viewed[viewedKey(r.workspaceId, f.path)] === f.hash,
                ).length
              }
              comments={(fs) =>
                fs.reduce((n, f) => n + commentCount(ref(f)), 0)
              }
              onToggle={onToggleDir}
              row={row}
            />
          );
        return (
          <div
            key={r.workspaceId}
            role="group"
            aria-label={r.name}
            className="review-repo"
          >
            {grouped && <div className="review-repo-name">{r.name}</div>}
            {r.error && (
              <div role="alert" className="review-repo-error small">
                {r.error}
              </div>
            )}
            {files(normal)}
            {generated.length > 0 && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm review-generated"
                  aria-expanded={Boolean(openGenerated[r.workspaceId])}
                  onClick={() =>
                    setOpenGenerated({
                      ...openGenerated,
                      [r.workspaceId]: !openGenerated[r.workspaceId],
                    })
                  }
                >
                  {`Generated (${generated.length})`}
                </button>
                {openGenerated[r.workspaceId] && files(generated)}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
