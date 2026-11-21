import type { LucideIcon } from 'lucide-react';

// A tab whose phase has not shipped yet: says plainly what it will hold.
export default function ComingSoon({
  phase,
  title,
  body,
  Icon,
  items,
}: {
  phase: number;
  title: string;
  body: string;
  Icon: LucideIcon;
  items: string[];
}) {
  return (
    <section className="card soon-card">
      <div className="empty-icon" style={{ margin: '0 auto 16px' }}>
        <Icon size={26} strokeWidth={2.3} />
      </div>
      <span className="badge">Arrives In Phase {phase}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      <div className="bal soon-list">
        {items.map((i) => (
          <div key={i} className="tile" style={{ ['--c' as string]: 'var(--text-3)' }}>
            <i className="dot" aria-hidden />
            <span className="name">{i}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
