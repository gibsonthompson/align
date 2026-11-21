import type { Crumb } from '@/lib/types';
import Breadcrumbs from '@/components/Breadcrumbs';
import MenuButton from '@/components/MenuButton';

// The bar across the top of every page: where you are on the left, actions on the right.
export default function TopBar({ path, title, children }: { path?: Crumb[]; title?: string; children?: React.ReactNode }) {
  return (
    <header className="top">
      <MenuButton />
      {path && path.length ? (
        <Breadcrumbs path={path} />
      ) : (
        <span className="crumb here" style={{ padding: 0 }}>
          {title}
        </span>
      )}
      <div className="top-actions">{children}</div>
    </header>
  );
}
