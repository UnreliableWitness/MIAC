import { useState } from 'react';
import { artUrl, type ArtName } from '../art';

export function ArtSlot({
  name,
  className = '',
}: {
  name: ArtName;
  className?: string;
}) {
  const url = artUrl(name);
  const [broken, setBroken] = useState(false);
  return (
    <div
      className={`art art-${name}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      {url && !broken ? (
        <img src={url} alt="" onError={() => setBroken(true)} />
      ) : (
        <div className="art-placeholder" />
      )}
    </div>
  );
}
