import { Add16Regular } from '@fluentui/react-icons';
import type { NewTerminal } from '../../shared/types';
import { MenuButton } from './ui/MenuButton';

/** What the + menu can open; the shell is named after the platform's shell by main. */
export const NEW_TERMINALS: {
  def: NewTerminal;
  title: string;
  note?: string;
}[] = [
  { def: { kind: 'claude', label: 'Claude Code' }, title: 'Claude Code' },
  { def: { kind: 'shell', label: 'shell' }, title: 'Shell' },
  { def: { kind: 'copilot', label: 'Copilot CLI' }, title: 'Copilot CLI' },
  {
    def: { kind: 'opencode', label: 'OpenCode' },
    title: 'OpenCode',
    note: 'AI cost not tracked',
  },
];

/**
 * The + button of the terminal row: a menu of terminal types. With `shellRepos` (a task folder with several
 * repos) there is a shell per repo, opening in that repo's worktree.
 */
export function NewTerminalMenu({
  disabled,
  onOpen,
  shellRepos,
}: {
  disabled?: boolean;
  onOpen: (def: NewTerminal) => void;
  shellRepos?: { repoId: string; dir: string }[];
}) {
  const items = NEW_TERMINALS.flatMap((t) =>
    t.def.kind === 'shell' && shellRepos && shellRepos.length > 0
      ? shellRepos.map((r) => ({
          key: `shell:${r.repoId}`,
          title: shellRepos.length > 1 ? `Shell in ${r.dir}` : t.title,
          onSelect: () => onOpen({ ...t.def, repoId: r.repoId }),
        }))
      : [
          {
            key: t.def.kind,
            title: t.title,
            note: t.note,
            onSelect: () => onOpen(t.def),
          },
        ],
  );
  return (
    <MenuButton
      label="New terminal"
      title="New terminal"
      className="btn btn-subtle btn-sm tab-add"
      disabled={disabled}
      items={items}
    >
      <Add16Regular />
    </MenuButton>
  );
}
