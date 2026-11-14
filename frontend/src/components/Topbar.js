import React from 'react';

const SEVERITY_COLOR = {
  queued: 'var(--warning)',
  in_progress: 'var(--accent)',
  completed: 'var(--success)',
  failure: 'var(--danger)',
};

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  ai: 'Phân tích AI',
  scan: 'Quét & Lỗ hổng',
  alerts: 'Cảnh báo',
  logs: 'Logs',
  reports: 'Báo cáo',
  config: 'Cấu hình',
  users: 'Người dùng',
  settings: 'Cài đặt',
};

export default function Topbar({ clock, scanInfo, page, theme, onToggleTheme }) {
  const timeStr = clock.toLocaleTimeString('vi-VN');
  const dateStr = clock.toLocaleDateString('vi-VN', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  });

  return (
    <header style={{
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
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
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
          {PAGE_TITLES[page] || 'Dashboard'}
        </h1>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
          Cloud Security Monitoring - lien ket pipeline GitHub Actions
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Scan status */}
        {scanInfo && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8,
            background: 'var(--bg)',
            border: `1px solid ${SEVERITY_COLOR[scanInfo.status] || 'var(--border)'}`,
            fontSize: 12, color: SEVERITY_COLOR[scanInfo.status] || 'var(--text-muted)',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: SEVERITY_COLOR[scanInfo.status] || 'var(--text-muted)',
              ...(scanInfo.status !== 'completed' ? {
                animation: 'pulse 1.5s infinite',
              } : {}),
            }} />
            {scanInfo.status === 'completed' ? 'Quet xong' : scanInfo.status}
          </div>
        )}

        {/* Clock */}
        <div style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '6px 14px',
          textAlign: 'center',
          minWidth: 160,
        }}>
          <div style={{
            fontSize: 18, fontWeight: 700, color: 'var(--accent)',
            fontVariantNumeric: 'tabular-nums', letterSpacing: 1,
          }}>
            {timeStr}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{dateStr}</div>
        </div>

        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
          aria-label="Chuyển giao diện sáng/tối"
          style={{
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            background: 'var(--surface-2)',
            color: theme === 'dark' ? 'var(--warning)' : 'var(--accent)',
            border: '1px solid var(--border)',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </header>
  );
}
