import React from 'react';

const SEVERITY_COLOR = {
  queued: '#d29922',
  in_progress: '#388bfd',
  completed: '#3fb950',
  failure: '#f85149',
};

export default function Topbar({ clock, scanInfo }) {
  const timeStr = clock.toLocaleTimeString('vi-VN');
  const dateStr = clock.toLocaleDateString('vi-VN', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  });

  return (
    <header style={{
      background: '#161b22',
      borderBottom: '1px solid #30363d',
      padding: '0 28px',
      height: 56,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 10,
      flexShrink: 0,
    }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#e6edf3' }}>
          Dashboard
        </h1>
        <p style={{ margin: 0, fontSize: 12, color: '#8b949e' }}>
          Cloud Security Monitoring - lien ket pipeline GitHub Actions
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Scan status */}
        {scanInfo && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8,
            background: '#0d1117',
            border: `1px solid ${SEVERITY_COLOR[scanInfo.status] || '#30363d'}`,
            fontSize: 12, color: SEVERITY_COLOR[scanInfo.status] || '#8b949e',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: SEVERITY_COLOR[scanInfo.status] || '#8b949e',
              ...(scanInfo.status !== 'completed' ? {
                animation: 'pulse 1.5s infinite',
              } : {}),
            }} />
            {scanInfo.status === 'completed' ? 'Quet xong' : scanInfo.status}
          </div>
        )}

        {/* Clock */}
        <div style={{
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: 8,
          padding: '6px 14px',
          textAlign: 'center',
          minWidth: 160,
        }}>
          <div style={{
            fontSize: 18, fontWeight: 700, color: '#388bfd',
            fontVariantNumeric: 'tabular-nums', letterSpacing: 1,
          }}>
            {timeStr}
          </div>
          <div style={{ fontSize: 10, color: '#8b949e' }}>{dateStr}</div>
        </div>
      </div>
    </header>
  );
}
