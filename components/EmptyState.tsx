import type { LucideIcon } from 'lucide-react';

export default function EmptyState({
  Icon,
  title,
  body,
  big = false,
  children,
}: {
  Icon: LucideIcon;
  title: string;
  body: string;
  big?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`empty${big ? ' big' : ''}`}>
      <div className="empty-icon">
        <Icon size={big ? 18 : 15} strokeWidth={2} />
      </div>
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
        {children}
      </div>
    </div>
  );
}
