import type { DocFile } from '../../../shared/types';

export const TASK_FILE = '.shellie/task.md';

const dirOf = (p: string) =>
  p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

function Entry({
  file,
  label,
  current,
  onOpen,
}: {
  file: DocFile;
  label: string;
  current: string | null;
  onOpen(path: string): void;
}) {
  return (
    <button
      type="button"
      className={`docs-file${current === file.path ? ' is-current' : ''}`}
      title={file.path}
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

/** The file list: a filter, the pinned Task file, then folder groups. */
export function DocsList({
  files,
  filter,
  onFilter,
  current,
  onOpen,
  hidden,
}: {
  files: DocFile[];
  filter: string;
  onFilter(v: string): void;
  current: string | null;
  onOpen(path: string): void;
  hidden: boolean;
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
    <aside className="docs-list" hidden={hidden} aria-label="Files">
      <input
        className="input docs-filter"
        placeholder="Filter"
        aria-label="Filter files"
        value={filter}
        onChange={(e) => onFilter(e.target.value)}
      />
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
    </aside>
  );
}
