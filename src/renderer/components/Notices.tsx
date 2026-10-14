import { useStore } from '../store';

export function Notices() {
  const notices = useStore((s) => s.notices);
  const dismiss = useStore((s) => s.dismiss);
  if (notices.length === 0) return null;
  return (
    <div className="notices" role="status">
      {notices.map((n) => (
        <div key={n.id} className={`notice notice-${n.level}`}>
          <span>{n.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(n.id)}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
