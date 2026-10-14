import type { HTMLAttributes, ReactNode } from 'react';

export function Bracketed({
  active = false,
  className = '',
  children,
  ...rest
}: { active?: boolean; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={`bracketed${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  );
}
