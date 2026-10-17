/** The thin spent/estimate bar; amber past the estimate. */
export function TimeBar({ pct, over }: { pct: number; over: boolean }) {
  return (
    <span className={over ? 'time-bar over' : 'time-bar'}>
      <i style={{ width: `${Math.min(100, pct)}%` }} />
    </span>
  );
}
