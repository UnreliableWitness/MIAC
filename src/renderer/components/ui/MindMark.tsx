import iconUrl from '../../../../assets/icon/png/64.png?inline';

// The app icon itself (assets/icon/png/64.png), shown as a small decorative mark.
export function MindMark({ size = 16 }: { size?: number }) {
  return (
    <img
      src={iconUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className="mindmark"
    />
  );
}
