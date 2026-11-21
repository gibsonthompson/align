import type { LucideIcon } from 'lucide-react';

export default function EmptyState({
  Icon,
  title,
  body,
  small = false,
  children,
}: {
  Icon: LucideIcon;
  title: string;
  body: string;
  small?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`empty${small ? ' small' : ''}`}>
      <div className="empty-icon">
        <Icon size={small ? 22 : 26} strokeWidth={2.3} />
      </div>
      <div>
        <h3>{title}</h3>
        <p style={{ marginTop: 4 }}>{body}</p>
        {children}
      </div>
    </div>
  );
}
