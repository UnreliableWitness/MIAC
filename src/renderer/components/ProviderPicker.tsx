import { useId } from 'react';
import type { TrackerProvider } from '../../shared/trackers';

export type ProviderChoice = TrackerProvider | 'none';

const CARDS: {
  value: ProviderChoice;
  title: string;
  text: string;
  soon?: string;
}[] = [
  {
    value: 'azure-devops',
    title: 'Azure DevOps',
    text: 'Work items, sprints, Azure Repos pull requests',
  },
  {
    value: 'github',
    title: 'GitHub',
    text: 'Issues, Projects iterations, pull requests',
    soon: 'Issues, Projects iterations and pull requests come in a later release',
  },
  {
    value: 'none',
    title: 'No tracker',
    text: 'Blank tasks on a branch, no write-back',
  },
];

/** Where work items live: Azure DevOps, GitHub (not yet) or no tracker at all. */
export function ProviderPicker({
  value,
  onChange,
}: {
  value: ProviderChoice;
  onChange: (value: ProviderChoice) => void;
}) {
  const name = useId();
  return (
    <div className="provider-picker" role="radiogroup" aria-label="Tracker">
      {CARDS.map((c) => (
        <label
          key={c.value}
          className={`provider-card${value === c.value ? ' selected' : ''}${c.soon ? ' disabled' : ''}`}
          title={c.soon}
        >
          <input
            type="radio"
            name={name}
            checked={value === c.value}
            disabled={!!c.soon}
            onChange={() => onChange(c.value)}
          />
          <span className="provider-card-text">
            <strong>{c.title}</strong>
            {c.soon && <span className="pill-soon">Soon</span>}
            <span className="small muted">{c.text}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
