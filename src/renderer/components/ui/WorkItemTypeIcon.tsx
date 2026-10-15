import { useTypeMeta } from '../../workItemTypes';

/** ADO's default type colors, used until the real icons are fetched from the project. */
const TYPE_COLOR: Record<string, string> = {
  bug: '#CC293D',
  task: '#F2CB1D',
  'user story': '#009CCC',
  'product backlog item': '#009CCC',
  feature: '#773B93',
  epic: '#FF7B00',
  issue: '#B4009E',
};

export const typeColor = (type: string): string =>
  TYPE_COLOR[type.toLowerCase()] ?? '#888';

/**
 * The work item type icon: ADO's own icon (a data URL, given or looked up for `connectionId`),
 * else a square in the type color.
 */
export function WorkItemTypeIcon({
  type,
  connectionId,
  iconUrl: givenIcon,
  color: givenColor,
  size = 16,
}: {
  type: string;
  connectionId?: string | null;
  iconUrl?: string | null;
  color?: string | null;
  size?: number;
}) {
  const meta = useTypeMeta(connectionId, type);
  const iconUrl = givenIcon ?? meta?.icon;
  const color = givenColor ?? meta?.color;
  if (iconUrl)
    return (
      <img
        className="wit-icon"
        src={iconUrl}
        width={size}
        height={size}
        alt={type}
        title={type}
      />
    );
  return (
    <span
      className="wit-icon wit-fallback"
      role="img"
      aria-label={type}
      title={type}
      style={{ width: size, height: size }}
    >
      <span style={{ background: color ?? typeColor(type) }} />
    </span>
  );
}
