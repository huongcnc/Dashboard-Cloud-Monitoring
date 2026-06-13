import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchLogs } from '../utils/api';

/* ── level heuristic từ message text ── */
function detectLevel(service, message) {
  const txt = (message + ' ' + service).toLowerCase();
  if (/error|fail|fatal|denied|critical|refused/.test(txt)) return 'error';
  if (/warn|block|drop|ufw|invalid/.test(txt))              return 'warn';
  if (/start|stop|restart|open|close|session/.test(txt))    return 'info';
  return 'debug';
}

const LEVEL_STYLE = {
  error: { color: '#f85149', bg: '#2d0f0f', label: 'ERROR' },
  warn:  { color: '#EF9F27', bg: '#2a1a04', label: 'WARN'  },
  info:  { color: '#388bfd', bg: '#0c1e36', label: 'INFO'  },
  debug: { color: '#8b949e', bg: '#161b22', label: 'DEBUG' },
};

function LevelBadge({ level }) {
  const s = LEVEL_STYLE[level] || LEVEL_STYLE.debug;
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px',
      borderRadius: 4, fontSize: 10, fontWeight: 700,
      background: s.bg, color: s.color,
      border: `1px solid ${s.color}44`,
      flexShrink: 0, fontFamily: 'monospace', letterSpacing: '0.04em',
    }}>
      {s.label}
    </span>
  );
}

function StatBadge({ label, value, color }) {
  return (
    <div style={{
      background: '#0d1117', border: '1px solid #30363d',
      borderRadius: 8, padding: '10px 16px', textAlign: 'center', minWidth: 90,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>{label}</div>
    </div>
  );
}

const AUTO_REFRESH_INTERVAL = 30_000; // 30s

export default function LogsPage() {
  const [data,       setData]       = useState(null);   // { total, logs }
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [levelFilter,setLevelFilter]= useState('ALL');
  const [search,     setSearch]     = useState('');
  const [autoRefresh,setAutoRefresh]= useState(false);
  const [lastRefresh,setLastRefresh]= useState(null);
  const bottomRef = useRef();
  const timerRef  = useRef();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchLogs();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  /* initial load */
  useEffect(() => { load(); }, [load]);

  /* auto-refresh */
  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(load, AUTO_REFRESH_INTERVAL);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [autoRefresh, load]);

  /* scroll to bottom when new data */
  useEffect(() => {
    if (data) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data]);

  /* enrich logs with level */
  const enriched = (data?.logs || []).map(log => ({
    ...log,
    level: detectLevel(log.service || '', log.message || ''),
  }));

  /* counts */
  const counts = enriched.reduce((acc, l) => {
    acc[l.level] = (acc[l.level] || 0) + 1;
    return acc;
  }, {});

  /* filter */
  const filtered = enriched.filter(log => {
    const matchLevel = levelFilter === 'ALL' || log.level === levelFilter;
    const q = search.toLowerCase();
    const matchSearch = !q ||
      log.message?.toLowerCase().includes(q) ||
      log.service?.toLowerCase().includes(q) ||
      log.host?.toLowerCase().includes(q);
    return matchLevel && matchSearch;
  });

  const levels = ['ALL', 'error', 'warn', 'info', 'debug'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Header card ── */}
      <div style={{
        background: '#161b22', border: '1px solid #30363d',
        borderRadius: 12, padding: '16px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e6edf3' }}>Quản trị Log</div>
          <div style={{ fontSize: 12, color: '#8b949e', marginTop: 2 }}>
            Linux Syslog — {data?.total ?? 0} dòng
            {lastRefresh && ` · Cập nhật: ${lastRefresh.toLocaleTimeString('vi-VN')}`}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(v => !v)}
            style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', border: '1px solid #30363d',
              background: autoRefresh ? '#1f6feb22' : '#21262d',
              color: autoRefresh ? '#388bfd' : '#8b949e',
            }}
          >
            {autoRefresh ? '⏸ Tắt tự động' : '▶ Tự động (30s)'}
          </button>

          {/* Refresh button */}
          <button
            onClick={load}
            disabled={loading}
            style={{
              padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              background: '#238636', color: '#fff', border: 'none',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? '⏳ Đang tải...' : '⟳ Làm mới'}
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{
          background: '#3d1515', border: '1px solid #f85149',
          borderRadius: 8, padding: '10px 16px', fontSize: 13, color: '#ffa198',
          display: 'flex', gap: 8, alignItems: 'center',
        }}>
          ⚠ {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#ffa198', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* ── Stats ── */}
      {data && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <StatBadge label="Tổng dòng"  value={data.total}           color="#e6edf3" />
          <StatBadge label="Error"      value={counts.error  || 0}   color="#f85149" />
          <StatBadge label="Warning"    value={counts.warn   || 0}   color="#EF9F27" />
          <StatBadge label="Info"       value={counts.info   || 0}   color="#388bfd" />
          <StatBadge label="Debug"      value={counts.debug  || 0}   color="#8b949e" />
        </div>
      )}

      {/* ── Filter bar ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {levels.map(lv => {
          const s = LEVEL_STYLE[lv];
          const isActive = levelFilter === lv;
          const cnt = lv === 'ALL' ? enriched.length : (counts[lv] || 0);
          return (
            <button key={lv} onClick={() => setLevelFilter(lv)} style={{
              padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s',
              background: isActive ? (s?.bg || '#21262d') : '#161b22',
              color: isActive ? (s?.color || '#e6edf3') : '#8b949e',
              border: `1px solid ${isActive ? (s?.color || '#388bfd') : '#30363d'}`,
            }}>
              {lv === 'ALL' ? `Tất cả (${cnt})` : `${s?.label} (${cnt})`}
            </button>
          );
        })}
        <input
          type="text" placeholder="🔍 Tìm trong log..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{
            marginLeft: 'auto', padding: '4px 12px', borderRadius: 6,
            border: '1px solid #30363d', background: '#161b22',
            color: '#e6edf3', fontSize: 12, outline: 'none', width: 220,
          }}
        />
      </div>

      {/* ── Log table ── */}
      <div style={{
        background: '#161b22', border: '1px solid #30363d',
        borderRadius: 12, overflow: 'hidden',
      }}>
        {/* Table header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '160px 60px 130px 90px 1fr',
          gap: 0,
          padding: '8px 16px',
          background: '#0d1117',
          borderBottom: '1px solid #30363d',
          fontSize: 11, fontWeight: 700, color: '#8b949e',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          <span>Timestamp</span>
          <span>Level</span>
          <span>Service</span>
          <span>PID</span>
          <span>Message</span>
        </div>

        {/* Rows */}
        <div style={{ maxHeight: 520, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12 }}>
          {!data && !loading && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#8b949e' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
              <div>Chưa có dữ liệu log</div>
            </div>
          )}

          {loading && !data && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#8b949e' }}>
              <div style={{ fontSize: 24, marginBottom: 10 }}>⏳</div>
              <div>Đang tải log từ server...</div>
            </div>
          )}

          {filtered.length === 0 && data && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#8b949e', fontSize: 13 }}>
              Không tìm thấy log nào khớp với bộ lọc.
            </div>
          )}

          {filtered.map((log, i) => {
            const s = LEVEL_STYLE[log.level] || LEVEL_STYLE.debug;
            return (
              <div key={i} style={{
                display: 'grid',
                gridTemplateColumns: '160px 60px 130px 90px 1fr',
                gap: 0,
                padding: '6px 16px',
                borderBottom: '1px solid #21262d',
                background: i % 2 === 0 ? 'transparent' : '#0d111780',
                alignItems: 'start',
              }}
                onMouseEnter={e => e.currentTarget.style.background = '#1f6feb14'}
                onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : '#0d111780'}
              >
                <span style={{ color: '#8b949e', fontSize: 11 }}>{log.timestamp}</span>
                <span><LevelBadge level={log.level} /></span>
                <span style={{ color: '#d2a8ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {log.service}
                </span>
                <span style={{ color: '#8b949e' }}>{log.pid || '—'}</span>
                <span style={{ color: s.color, wordBreak: 'break-word', lineHeight: 1.5 }}>
                  {log.message}
                </span>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Footer */}
        {data && (
          <div style={{
            padding: '8px 16px', borderTop: '1px solid #30363d',
            fontSize: 11, color: '#8b949e',
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>Hiển thị {filtered.length} / {enriched.length} dòng</span>
            <span>Nguồn: /log/sys.log (100 dòng gần nhất)</span>
          </div>
        )}
      </div>
    </div>
  );
}
