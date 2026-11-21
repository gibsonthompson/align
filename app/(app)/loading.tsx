export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="topbar">
        <div className="skeleton" style={{ width: 120, height: 30, borderRadius: 10 }} />
        <div className="skeleton" style={{ width: 110, height: 40, borderRadius: 999 }} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <div className="skeleton" style={{ width: 110, height: 26, borderRadius: 999 }} />
        <div className="skeleton" style={{ width: 140, height: 26, borderRadius: 999 }} />
      </div>
      <div className="skeleton" style={{ height: 190, marginBottom: 14 }} />
      <div className="stack">
        <div className="skeleton" style={{ height: 240 }} />
        <div className="skeleton" style={{ height: 160 }} />
      </div>
    </div>
  );
}
