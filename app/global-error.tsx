'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#000', color: '#fafafa', fontFamily: 'system-ui, sans-serif' }}>
        <main
          style={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 28, textWrap: 'balance' }}>Align Could Not Load</h1>
          <p style={{ margin: 0, color: '#9a9aa1', maxWidth: 300 }}>Something went wrong while starting the app.</p>
          <button
            onClick={reset}
            style={{ height: 50, padding: '0 26px', border: 0, borderRadius: 999, background: '#fafafa', color: '#000', fontSize: 16, fontWeight: 800 }}
          >
            Try Again
          </button>
        </main>
      </body>
    </html>
  );
}
