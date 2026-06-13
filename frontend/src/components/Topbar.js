import React, { useRef } from 'react';

export default function Topbar({ onScan, loading, clock }) {
  const fileRef = useRef();

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
          Theo dõi và giám sát các dịch vụ cloud
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Upload button */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 16px', borderRadius: 6,
          background: loading ? '#1a3a20' : '#238636',
          color: '#fff', fontSize: 13, fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
          border: 'none', transition: 'background 0.15s',
          userSelect: 'none',
        }}>
          {loading ? '⏳ Đang quét...' : '⬆ Quét Terraform'}
          <input
            type="file"
            accept=".tf,.json,.yaml,.yml,.zip"
            ref={fileRef}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) onScan(file);
              e.target.value = '';
            }}
            disabled={loading}
            style={{ display: 'none' }}
          />
        </label>

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
