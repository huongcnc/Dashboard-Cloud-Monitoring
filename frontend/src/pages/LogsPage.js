import React, { useEffect, useRef } from 'react';

const TYPE_STYLE = {
  info:    { color: '#8b949e' },
  success: { color: '#3fb950' },
  error:   { color: '#f85149' },
  warn:    { color: '#EF9F27' },
};

export default function LogsPage({ logs, onClear }) {
  const bottomRef = useRef();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div style={{
      background: '#161b22', border: '1px solid #30363d',
      borderRadius: 12, padding: '20px 24px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Quản trị Log
        </div>
        {logs.length > 0 && (
          <button onClick={onClear} style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 4,
            background: '#21262d', border: '1px solid #30363d',
            color: '#8b949e', cursor: 'pointer',
          }}>
            Xoá log
          </button>
        )}
      </div>

      {logs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#8b949e' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Chưa có dữ liệu log</div>
          <div style={{ fontSize: 13 }}>
            Dữ liệu log sẽ hiển thị tại đây khi có hoạt động.
          </div>
        </div>
      ) : (
        <div style={{
          fontFamily: 'monospace', fontSize: 12,
          display: 'flex', flexDirection: 'column', gap: 4,
          maxHeight: 500, overflowY: 'auto',
        }}>
          {logs.map((log, i) => (
            <div key={i} style={{
              padding: '6px 10px', borderRadius: 4,
              background: '#0d1117',
              color: (TYPE_STYLE[log.type] || TYPE_STYLE.info).color,
              display: 'flex', gap: 12, alignItems: 'flex-start',
            }}>
              <span style={{ color: '#484f58', flexShrink: 0 }}>[{log.time}]</span>
              <span>{log.msg}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
