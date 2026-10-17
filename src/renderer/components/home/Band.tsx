import type { ReactNode } from 'react';

export function Band({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="home-band">
      <h2 className="home-band-title">{title}</h2>
      {children}
    </section>
  );
}
