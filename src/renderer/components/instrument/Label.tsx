import type { ReactNode } from 'react';

export const Label = ({ children }: { children: ReactNode }) => (
  <span className="ilabel">{children}</span>
);
