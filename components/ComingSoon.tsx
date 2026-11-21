import type { LucideIcon } from 'lucide-react';

// A section whose phase has not shipped yet: says plainly what it will hold.
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
    <section className="panel soon-panel">
      <span className="tag">
        <Icon size={12} /> Phase {phase}
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
      <div className="bal">
        {items.map((i) => (
          <div key={i} className="tile">
            <span className="name">{i}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
