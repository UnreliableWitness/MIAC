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

/** The + button of the terminal row: a menu of terminal types. */
export function NewTerminalMenu({
  disabled,
  onOpen,
}: {
  disabled?: boolean;
  onOpen: (def: NewTerminal) => void;
}) {
  return (
    <MenuButton
      label="New terminal"
      title="New terminal"
      className="btn btn-subtle btn-sm tab-add"
      disabled={disabled}
      items={NEW_TERMINALS.map((t) => ({
        key: t.def.kind,
        title: t.title,
        note: t.note,
        onSelect: () => onOpen(t.def),
      }))}
    >
      <Add16Regular />
    </MenuButton>
  );
}
