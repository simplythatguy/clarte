import { useEffect, useRef, type ReactNode } from 'react';

export function StagePage({ title, children, alert = false }: { title: string; children?: ReactNode; alert?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className="stage-page" aria-labelledby="stage-title" role={alert ? 'alert' : undefined}>
    <h1 id="stage-title" ref={heading} tabIndex={-1}>{title}</h1>
    {children && <div className="stage-actions">{children}</div>}
  </section>;
}
