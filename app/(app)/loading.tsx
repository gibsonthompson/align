export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="top">
        <div className="skeleton" style={{ width: 260, height: 16, borderRadius: 4 }} />
      </div>
      <div className="content">
        <div className="page">
          <div className="page-main">
            <div className="skeleton" style={{ width: 160, height: 12, borderRadius: 4 }} />
            <div className="skeleton" style={{ width: '60%', height: 32, borderRadius: 6 }} />
            <div className="skeleton" style={{ height: 180 }} />
            <div className="skeleton" style={{ height: 240 }} />
          </div>
          <div className="page-side">
            <div className="skeleton" style={{ height: 320 }} />
            <div className="skeleton" style={{ height: 160 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
