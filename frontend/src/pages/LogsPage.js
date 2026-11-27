import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchLogs } from '../utils/api';
import TimeRangePicker from '../components/TimeRangePicker';
import {
  resolveRange, inRange, isRangeActive, loadSharedRange, saveSharedRange, DEFAULT_RANGE,
} from '../utils/timeRange';

/* ------------------------------------------------------------------ */
/*  Cấu hình                                                           */
/* ------------------------------------------------------------------ */
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const CELL_FONT_PX = 12;
const MIN_W = 60;
const MAX_W = 1400;
const STORAGE_KEY = 'logsTable.v1';
const PAGE_SIZES = [25, 50, 100];

const pad = (n, len = 2) => String(n).padStart(len, '0');

/* 2026-11-26 16:57:02.735 (giờ local, có mili-giây như Kibana/Splunk) */
const fmtTime = v => {
  if (!v) return 'N/A';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

/* Mỗi cột = 1 trường dữ liệu, giống Discover của Kibana */
const COLUMNS = [
  { key: 'timestamp',    label: 'Thời gian',   width: 200, get: l => fmtTime(l.timestamp) },
  { key: 'level',        label: 'Level',       width: 90,  get: l => l.level || '' },
  { key: 'dataset',      label: 'Dataset',     width: 210, get: l => l.dataset || '' },
  { key: 'event_kind',   label: 'Event kind',  width: 100, get: l => l.event_kind || '' },
  { key: 'service',      label: 'Service',     width: 150, get: l => l.service || '' },
  { key: 'host',         label: 'Host',        width: 230, get: l => l.host || '' },
  { key: 'user',         label: 'User',        width: 110, get: l => l.user || '' },
  { key: 'process',      label: 'Process',     width: 130, get: l => l.process || '' },
  { key: 'command',      label: 'Command',     width: 260, get: l => l.command || '' },
  { key: 'technique_id', label: 'MITRE',       width: 100, get: l => l.technique_id || '' },
  { key: 'message',      label: 'Message',     width: 560, get: l => l.message || '' },
];
const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map(c => [c.key, c.width]));
const DEFAULT_HIDDEN = ['event_kind', 'service', 'technique_id'];

const LEVEL_COLOR = {
  fatal: 'var(--danger)', critical: 'var(--danger)', error: 'var(--danger)',
  warn: 'var(--warning)', warning: 'var(--warning)',
  info: 'var(--accent-text)', notice: 'var(--accent-text)',
  debug: 'var(--text-muted)', trace: 'var(--text-muted)',
};
const levelColor = lv => LEVEL_COLOR[String(lv).toLowerCase()] || 'var(--text-muted)';

const clampW = w => Math.max(MIN_W, Math.min(MAX_W, Math.round(w)));

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {}; } catch (e) { return {}; }
}

/* Tô sáng từ khóa tìm kiếm trong ô */
function highlight(text, term) {
  const t = (term || '').trim();
  if (!t) return text;
  const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
  const parts = String(text).split(re);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 === 1 ? <mark key={i} style={s.mark}>{p}</mark> : p));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function LogsPage() {
  const prefs = useRef(loadPrefs()).current;

  const [widths, setWidths] = useState(() => ({ ...DEFAULT_WIDTHS, ...(prefs.widths || {}) }));
  const [hidden, setHidden] = useState(() => prefs.hidden || DEFAULT_HIDDEN);
  const [wrap, setWrap] = useState(!!prefs.wrap);
  const [pageSize, setPageSize] = useState(prefs.pageSize || 50);

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [range, setRange] = useState(loadSharedRange);
  const [appliedRange, setAppliedRange] = useState({ from: null, to: null }); // khoảng đã dùng cho dữ liệu đang hiện

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [colMenu, setColMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const reqId = useRef(0);

  /* nhớ độ rộng cột, cột ẩn, wrap, page size */
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ widths, hidden, wrap, pageSize }));
    } catch (e) { /* ignore */ }
  }, [widths, hidden, wrap, pageSize]);

  /* debounce ô tìm kiếm: không gọi API sau mỗi phím gõ */
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  /* tải dữ liệu (bỏ qua phản hồi cũ nếu đã có yêu cầu mới hơn) */
  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    setError('');
    const resolved = resolveRange(range); // tính lại mỗi lần tải để "24 giờ qua", "Hôm nay" luôn mới
    fetchLogs(page, pageSize, debouncedQ, resolved)
      .then(res => { if (id === reqId.current) { setData(res); setAppliedRange(resolved); } })
      .catch(e => { if (id === reqId.current) setError(e.message); })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  }, [page, pageSize, debouncedQ, tick, range]);

  /* Esc đóng khung chi tiết */
  useEffect(() => {
    if (!detail) return undefined;
    const onKey = e => { if (e.key === 'Escape') setDetail(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail]);

  /* lọc thêm ở client để đúng cả khi backend chưa hỗ trợ from/to */
  const rows = useMemo(
    () => (data?.logs || []).filter(l => inRange(new Date(l.timestamp).getTime(), appliedRange)),
    [data, appliedRange],
  );
  const rangeOn = isRangeActive(range);
  const changeRange = r => { setRange(r); saveSharedRange(r); setPage(1); };
  const total = data?.total || 0;
  const totalPages = data?.total_pages || 1;
  const visible = useMemo(() => COLUMNS.filter(c => !hidden.includes(c.key)), [hidden]);

  /* cột cuối co giãn lấp đầy chỗ trống, các cột còn lại đúng số px */
  const template = visible
    .map((c, i) => (i === visible.length - 1 ? `minmax(${widths[c.key]}px, 1fr)` : `${widths[c.key]}px`))
    .join(' ');
  const totalW = visible.reduce((sum, c) => sum + widths[c.key], 0);

  /* ---------- kéo mép cột để đổi độ rộng (như Excel) ---------- */
  const startResize = (e, key) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[key];
    const onMove = ev => setWidths(w => ({ ...w, [key]: clampW(startW + ev.clientX - startX) }));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  /* ---------- nhấp đúp mép cột: tự khớp độ rộng với nội dung dài nhất ---------- */
  const autoFit = col => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = `${CELL_FONT_PX}px ${MONO}`;
    let max = 0;
    rows.forEach(l => { max = Math.max(max, ctx.measureText(String(col.get(l))).width); });
    ctx.font = `700 11px ${MONO}`;
    max = Math.max(max, ctx.measureText(col.label).width + 14);
    setWidths(w => ({ ...w, [col.key]: clampW(max + 28) }));
  };

  const resetColumns = () => {
    setWidths(DEFAULT_WIDTHS);
    setHidden(DEFAULT_HIDDEN);
    setWrap(false);
  };

  const toggleColumn = key => {
    setHidden(h => {
      if (h.includes(key)) return h.filter(k => k !== key);
      if (visible.length <= 1) return h; // luôn giữ ít nhất 1 cột
      return [...h, key];
    });
  };

  /* bôi đen chữ để copy thì không mở khung chi tiết */
  const openDetail = log => {
    const sel = window.getSelection && String(window.getSelection());
    if (sel && sel.length > 0) return;
    setDetail(log);
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(detail.raw || detail, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) { /* ignore */ }
  };

  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  const source = data?.fallback ? 'logs.json (offline)' : 'Elasticsearch';

  const cellStyle = col => ({
    ...s.cell,
    ...(wrap ? s.cellWrap : s.cellClip),
    ...(col.key === 'timestamp' ? { color: 'var(--text-muted)' } : null),
    ...(col.key === 'message' ? { color: 'var(--text)' } : null),
  });

  return (
    <div style={s.page}>
      <style>{CSS}</style>

      <header style={s.header}>
        <div>
          <h1 style={s.h1}>Logs hệ thống</h1>
          <p style={s.muted}>ECS events từ {source} · {total.toLocaleString('vi-VN')} bản ghi</p>
        </div>
        <button style={s.btnPrimary} onClick={() => setTick(t => t + 1)}>
          {loading ? 'Đang tải...' : 'Làm mới'}
        </button>
      </header>

      {error && <div style={s.error}>Không thể tải log: {error}</div>}
      {data?.fallback && (
        <div style={s.notice}>
          ⚠ Không kết nối được máy chủ ({data.fallback_reason}). Đang hiển thị dữ liệu mẫu từ logs.json — {data.total} bản ghi.
        </div>
      )}

      {/* ----- thanh công cụ ----- */}
      <div style={s.toolbar}>
        <input
          style={s.search}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Tìm document ID, host, user, command, dataset, message..."
        />
        <TimeRangePicker value={range} onChange={changeRange} />
        <label style={s.check}>
          <input type="checkbox" checked={wrap} onChange={e => setWrap(e.target.checked)} />
          Xuống dòng
        </label>

        <div style={{ position: 'relative' }}>
          <button style={s.btn} onClick={() => setColMenu(v => !v)}>Cột ▾</button>
          {colMenu && (
            <>
              <div style={s.menuBackdrop} onClick={() => setColMenu(false)} />
              <div style={s.menu}>
                {COLUMNS.map(c => (
                  <label key={c.key} style={s.menuItem}>
                    <input
                      type="checkbox"
                      checked={!hidden.includes(c.key)}
                      onChange={() => toggleColumn(c.key)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <button style={s.btn} onClick={resetColumns} title="Đặt lại độ rộng và cột hiển thị">Đặt lại cột</button>

        <select
          style={s.select}
          value={pageSize}
          onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
          title="Số dòng mỗi trang"
        >
          {PAGE_SIZES.map(n => <option key={n} value={n}>{n} dòng/trang</option>)}
        </select>
      </div>

      <div style={s.status}>
        <span>Hiển thị <b>{from}–{to}</b> / {total.toLocaleString('vi-VN')}</span>
        <span style={s.hint}>Kéo mép tiêu đề cột để đổi độ rộng · Nhấp đúp để tự khớp nội dung</span>
      </div>

      {/* ----- bảng ----- */}
      <section className="lg-scroll" style={{ ...s.scroll, opacity: loading && data ? 0.6 : 1 }}>
        <div style={{ minWidth: totalW }}>
          <div style={{ ...s.head, gridTemplateColumns: template }}>
            {visible.map(c => (
              <div key={c.key} className="lg-hcell" style={s.hcell}>
                <span style={s.hlabel}>{c.label}</span>
                <span
                  className="lg-resizer"
                  onMouseDown={e => startResize(e, c.key)}
                  onDoubleClick={() => autoFit(c)}
                  title="Kéo để đổi độ rộng · Nhấp đúp để tự khớp nội dung"
                />
              </div>
            ))}
          </div>

          {!loading && !rows.length && (
            <div style={s.empty}>
              Không có log phù hợp{rangeOn ? ' trong khoảng thời gian đã chọn' : ''}.
              {rangeOn && <button style={s.linkBtn} onClick={() => changeRange(DEFAULT_RANGE)}>Xem tất cả thời gian</button>}
            </div>
          )}
          {loading && !data && <div style={s.empty}>Đang tải log...</div>}

          {rows.map((log, i) => (
            <div
              key={log.document_id || log.id || i}
              className="lg-row"
              style={{ ...s.row, gridTemplateColumns: template }}
              onClick={() => openDetail(log)}
            >
              {visible.map(c => {
                const text = String(c.get(log));
                return (
                  <div key={c.key} style={cellStyle(c)} title={wrap ? undefined : text}>
                    {!text && <span style={s.dim}>—</span>}
                    {text && c.key === 'level' && (
                      <span style={{ ...s.badge, color: levelColor(text), borderColor: levelColor(text) }}>
                        {text.toUpperCase()}
                      </span>
                    )}
                    {text && c.key !== 'level' && highlight(text, debouncedQ)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {/* ----- phân trang ----- */}
      {totalPages > 1 && (
        <nav style={s.pagination}>
          <button style={s.btn} disabled={page === 1} onClick={() => setPage(1)}>« Đầu</button>
          <button style={s.btn} disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Trước</button>
          <b>Trang {page} / {totalPages.toLocaleString('vi-VN')}</b>
          <button style={s.btn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Sau →</button>
          <button style={s.btn} disabled={page >= totalPages} onClick={() => setPage(totalPages)}>Cuối »</button>
        </nav>
      )}

      {/* ----- khung chi tiết ----- */}
      {detail && (
        <div style={s.overlay} onClick={() => setDetail(null)}>
          <aside style={s.drawer} onClick={e => e.stopPropagation()}>
            <button style={s.close} onClick={() => setDetail(null)} aria-label="Đóng">×</button>
            <h2 style={{ marginTop: 0 }}>Chi tiết event</h2>

            <dl style={s.dl}>
              {[
                ['Thời gian', fmtTime(detail.timestamp)],
                ['Level', detail.level],
                ['Dataset', detail.dataset],
                ['Service', detail.service],
                ['Event kind', detail.event_kind],
                ['Host', detail.host],
                ['User', detail.user],
                ['Process', detail.process],
                ['Command', detail.command],
                ['MITRE', [detail.technique_id, detail.technique_name].filter(Boolean).join(' · ')],
                ['Index', detail.index],
                ['Document ID', detail.document_id || detail.id],
              ].map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt style={s.dt}>{k}</dt>
                  <dd style={s.dd}>{v || <span style={s.dim}>—</span>}</dd>
                </React.Fragment>
              ))}
            </dl>

            <h3 style={s.h3}>Message</h3>
            <pre style={s.msgBox}>{detail.message || 'Không có message'}</pre>

            <div style={s.rawHead}>
              <h3 style={{ ...s.h3, margin: 0 }}>Raw JSON</h3>
              <button style={s.btn} onClick={copyJson}>{copied ? 'Đã copy ✓' : 'Copy'}</button>
            </div>
            <pre style={s.raw}>{JSON.stringify(detail.raw || detail, null, 2)}</pre>
          </aside>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Style                                                              */
/* ------------------------------------------------------------------ */
/* hover / con trỏ kéo cột cần CSS thật (inline style không có :hover) */
const CSS = `
.lg-row { cursor: pointer; }
.lg-row:hover { background: var(--surface-2); }
.lg-hcell { position: relative; }
.lg-resizer { position: absolute; top: 0; right: -4px; width: 9px; height: 100%; cursor: col-resize; z-index: 3; }
.lg-resizer::after { content: ''; position: absolute; left: 4px; top: 22%; height: 56%; width: 1px; background: var(--border); }
.lg-hcell:hover .lg-resizer::after, .lg-resizer:hover::after { background: var(--accent); width: 2px; left: 3px; }
`;

const s = {
  page: { color: 'var(--text)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  h1: { margin: 0, fontSize: 24 },
  h3: { fontSize: 13, margin: '18px 0 8px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 },
  muted: { color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 0' },

  linkBtn: { background: 'none', border: 0, color: 'var(--accent-text)', cursor: 'pointer', fontSize: 13, marginLeft: 8, textDecoration: 'underline' },
  btnPrimary: { background: 'var(--success-strong)', color: '#fff', border: 0, borderRadius: 6, padding: '9px 16px', cursor: 'pointer' },
  btn: { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', cursor: 'pointer', fontSize: 13 },
  select: { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 13 },
  check: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap', cursor: 'pointer' },

  error: { background: 'var(--danger-bg)', color: 'var(--danger-text)', padding: 12, borderRadius: 6, marginBottom: 12 },
  notice: { background: 'var(--warning-bg)', color: 'var(--warning)', border: '1px solid var(--warning-border)', padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 13 },

  toolbar: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 },
  search: { flex: 1, minWidth: 260, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px' },
  status: { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 },
  hint: { fontStyle: 'italic' },

  menuBackdrop: { position: 'fixed', inset: 0, zIndex: 15 },
  menu: { position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 16, minWidth: 180, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 6, boxShadow: '0 8px 24px rgba(0,0,0,.35)' },
  menuItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer', borderRadius: 4 },

  scroll: { border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', overflow: 'auto', maxHeight: 'calc(100vh - 340px)', minHeight: 240, transition: 'opacity .15s' },
  head: { display: 'grid', position: 'sticky', top: 0, zIndex: 5, background: 'var(--surface)', borderBottom: '1px solid var(--border)' },
  hcell: { padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-muted)', textTransform: 'uppercase', minWidth: 0, display: 'flex', alignItems: 'center' },
  hlabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 6 },

  row: { display: 'grid', borderBottom: '1px solid var(--surface-2)' },
  cell: { padding: '8px 12px', fontFamily: MONO, fontSize: CELL_FONT_PX, lineHeight: 1.5, minWidth: 0, color: 'var(--text-secondary)', borderRight: '1px solid var(--surface-2)' },
  cellClip: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cellWrap: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  dim: { color: 'var(--text-muted)', opacity: 0.5 },
  mark: { background: 'var(--warning)', color: '#000', borderRadius: 2, padding: '0 1px' },
  badge: { display: 'inline-block', border: '1px solid', borderRadius: 4, padding: '0 6px', fontSize: 10, fontWeight: 700, lineHeight: '16px' },
  empty: { padding: 60, textAlign: 'center', color: 'var(--text-muted)' },

  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: 20, flexWrap: 'wrap' },

  overlay: { position: 'fixed', inset: 0, background: 'var(--overlay)', zIndex: 20 },
  drawer: { position: 'absolute', right: 0, top: 0, height: '100%', width: 'min(760px, 94vw)', background: 'var(--surface)', padding: 26, overflow: 'auto', boxSizing: 'border-box' },
  close: { float: 'right', background: 'none', border: 0, color: 'var(--text-muted)', fontSize: 28, cursor: 'pointer' },
  dl: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 14px', margin: 0, fontSize: 13 },
  dt: { color: 'var(--text-muted)' },
  dd: { margin: 0, fontFamily: MONO, fontSize: 12, wordBreak: 'break-all' },
  msgBox: { background: 'var(--bg)', padding: 12, borderRadius: 6, fontFamily: MONO, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 },
  rawHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 0 8px' },
  raw: { background: 'var(--bg)', padding: 14, color: 'var(--text-secondary)', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', borderRadius: 6, margin: 0 },
};