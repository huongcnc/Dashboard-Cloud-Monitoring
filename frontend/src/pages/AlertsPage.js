import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchAlerts } from '../utils/api';
import TimeRangePicker from '../components/TimeRangePicker';
import {
  resolveRange, inRange, isRangeActive, loadSharedRange, saveSharedRange, DEFAULT_RANGE,
} from '../utils/timeRange';

/* ------------------------------------------------------------------ */
/*  Hằng số & tiện ích                                                 */
/* ------------------------------------------------------------------ */
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const CELL_FONT_PX = 12;
const MIN_W = 60;
const MAX_W = 1400;
const STORAGE_KEY = 'alertsTable.v1';
const PAGE_SIZES = [25, 50, 100];

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const SEV_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
const SEV_COLOR = {
  CRITICAL: 'var(--danger)',
  HIGH: 'var(--high)',
  MEDIUM: 'var(--warning)',
  LOW: 'var(--success)',
  INFO: 'var(--accent-text)',
};
const sevColor = sv => SEV_COLOR[sv] || 'var(--text-muted)';

const STATUS_LABEL = { open: 'Mở', acknowledged: 'Đã ghi nhận', 'in-progress': 'Đang xử lý', closed: 'Đã đóng' };
const STATUS_COLOR = {
  open: 'var(--accent-text)',
  acknowledged: 'var(--warning)',
  'in-progress': 'var(--warning)',
  closed: 'var(--text-muted)',
};

const pad = (n, len = 2) => String(n).padStart(len, '0');

/* 2026-11-22 08:07:45.033 (giờ local, có mili-giây) */
const fmtTime = v => {
  if (!v) return 'N/A';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};
const fmtClock = ms => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const clampW = w => Math.max(MIN_W, Math.min(MAX_W, Math.round(w)));
const isUrl = u => typeof u === 'string' && /^https?:\/\//i.test(u);

/* raw của Elasticsearch vừa có khóa phẳng 'kibana.alert.reason' vừa có object lồng 'source.ip' */
function getPath(obj, path) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (path in obj) return obj[path];
  return path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}
const asText = v => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v));

/* Chuẩn hóa mỗi cảnh báo thành 1 "row" gồm bản gốc (a) và các trường dẫn xuất (v) */
function toRow(a) {
  const r = a.raw || {};
  const g = p => getPath(r, p);
  const mitre = Array.isArray(a.mitre_attack) ? a.mitre_attack : [];
  const techniques = [];
  mitre.forEach(m => (m.technique || []).forEach(t => techniques.push(t)));
  return {
    a,
    sev: String(a.severity || '').toUpperCase(),
    ts: new Date(a.timestamp).getTime(),
    status: String(a.status || g('kibana.alert.workflow_status') || ''),
    srcIp: asText(g('source.ip')),
    action: asText(g('kibana.alert.original_event.action') || g('event.action')),
    outcome: asText(g('kibana.alert.original_event.outcome') || g('event.outcome')),
    dataset: asText(g('kibana.alert.original_event.dataset') || g('data_stream.dataset')),
    reason: asText(g('kibana.alert.reason')),
    tags: g('kibana.alert.rule.tags') || [],
    note: asText(g('kibana.alert.rule.note')),
    interval: asText(g('kibana.alert.rule.interval')),
    from: asText(g('kibana.alert.rule.from')),
    indices: g('kibana.alert.rule.indices') || [],
    references: g('kibana.alert.rule.references') || [],
    falsePositives: g('kibana.alert.rule.false_positives') || [],
    mitre,
    techniqueIds: techniques.map(t => t.id).filter(Boolean),
    mitreText: mitre
      .map(m => {
        const ids = (m.technique || []).map(t => t.id).filter(Boolean).join(', ');
        return `${m.tactic?.name || '?'}${ids ? ` (${ids})` : ''}`;
      })
      .join(' · '),
  };
}

/* Cột: sort = giá trị để sắp xếp, text = chuỗi thuần (đo độ rộng, tooltip, tìm) */
const COLUMNS = [
  { key: 'severity',  label: 'Mức độ',      width: 110, sort: r => SEV_RANK[r.sev] ?? -1,        text: r => r.sev },
  { key: 'risk',      label: 'Risk',        width: 130, sort: r => r.a.risk_score ?? -1,         text: r => asText(r.a.risk_score) },
  { key: 'timestamp', label: 'Thời gian',   width: 200, sort: r => r.ts,                         text: r => fmtTime(r.a.timestamp) },
  { key: 'title',     label: 'Rule',        width: 340, sort: r => (r.a.title || '').toLowerCase(), text: r => r.a.title || '' },
  { key: 'category',  label: 'Category',    width: 180, sort: r => (r.a.category || '').toLowerCase(), text: r => r.a.category || '' },
  { key: 'host',      label: 'Host',        width: 230, sort: r => (r.a.host || '').toLowerCase(), text: r => r.a.host || '' },
  { key: 'user',      label: 'User',        width: 110, sort: r => (r.a.user || '').toLowerCase(), text: r => r.a.user || '' },
  { key: 'srcIp',     label: 'Source IP',   width: 130, sort: r => r.srcIp,                      text: r => r.srcIp },
  { key: 'action',    label: 'Action',      width: 120, sort: r => r.action,                     text: r => r.action },
  { key: 'outcome',   label: 'Outcome',     width: 100, sort: r => r.outcome,                    text: r => r.outcome },
  { key: 'mitre',     label: 'MITRE ATT&CK', width: 300, sort: r => r.mitreText.toLowerCase(),  text: r => r.mitreText },
  { key: 'status',    label: 'Trạng thái',  width: 120, sort: r => r.status,                     text: r => STATUS_LABEL[r.status] || r.status },
  { key: 'rule_type', label: 'Rule type',   width: 90,  sort: r => (r.a.rule_type || ''),        text: r => r.a.rule_type || '' },
];
const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map(c => [c.key, c.width]));
const DEFAULT_HIDDEN = ['category', 'action', 'outcome', 'rule_type'];
const DESC_FIRST = ['severity', 'risk', 'timestamp'];

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {}; } catch (e) { return {}; }
}

function highlight(text, term) {
  const t = (term || '').trim();
  if (!t) return text;
  const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
  const parts = String(text).split(re);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 === 1 ? <mark key={i} style={s.mark}>{p}</mark> : p));
}

/* Gom cảnh báo theo thời gian để vẽ biểu đồ cột chồng theo mức độ */
function buildBuckets(rows, n = 32) {
  const valid = rows.filter(r => !isNaN(r.ts));
  if (!valid.length) return null;
  const min = Math.min(...valid.map(r => r.ts));
  const max = Math.max(...valid.map(r => r.ts));
  const size = Math.max(max - min, 1) / n;
  const buckets = Array.from({ length: n }, (_, i) => ({ start: min + i * size, counts: {}, total: 0 }));
  valid.forEach(r => {
    const b = buckets[Math.min(n - 1, Math.floor((r.ts - min) / size))];
    b.counts[r.sev] = (b.counts[r.sev] || 0) + 1;
    b.total += 1;
  });
  return { buckets, min, max, peak: Math.max(...buckets.map(b => b.total)) };
}

/* ------------------------------------------------------------------ */
/*  Component con                                                      */
/* ------------------------------------------------------------------ */
function SeverityBadge({ sev }) {
  const c = sevColor(sev);
  return <span style={{ ...s.badge, color: c, borderColor: c }}>{sev || 'N/A'}</span>;
}

function StatusBadge({ status }) {
  const c = STATUS_COLOR[status] || 'var(--text-muted)';
  return <span style={{ ...s.badge, color: c, borderColor: c }}>{STATUS_LABEL[status] || status || 'N/A'}</span>;
}

function RiskBar({ score, sev }) {
  const v = Math.max(0, Math.min(100, Number(score) || 0));
  return (
    <span style={s.riskWrap}>
      <b style={s.riskNum}>{score ?? '—'}</b>
      <span style={s.riskTrack}><span style={{ ...s.riskFill, width: `${v}%`, background: sevColor(sev) }} /></span>
    </span>
  );
}

function Timeline({ rows }) {
  const t = useMemo(() => buildBuckets(rows), [rows]);
  if (!t) return null;
  const W = 1000;
  const H = 76;
  const n = t.buckets.length;
  const bw = W / n;
  return (
    <div style={s.timeline}>
      <div style={s.timelineHead}>
        <b>Cảnh báo theo thời gian</b>
        <span style={s.legend}>
          {SEVERITIES.map(sv => (
            <span key={sv} style={s.legendItem}><i style={{ ...s.dot, background: sevColor(sv) }} />{sv}</span>
          ))}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={s.svg} role="img" aria-label="Biểu đồ cảnh báo theo thời gian">
        {t.buckets.map((b, i) => {
          let y = H;
          return (
            <g key={i}>
              <title>{`${fmtClock(b.start)} · ${b.total} cảnh báo`}</title>
              {SEVERITIES.slice().reverse().map(sv => {
                const c = b.counts[sv] || 0;
                if (!c) return null;
                const h = (c / t.peak) * (H - 6);
                y -= h;
                return <rect key={sv} x={i * bw + 1} y={y} width={Math.max(bw - 2, 1)} height={h} style={{ fill: sevColor(sv) }} />;
              })}
            </g>
          );
        })}
      </svg>
      <div style={s.axis}>
        <span>{fmtClock(t.min)}</span>
        <span>đỉnh: {t.peak} cảnh báo / khoảng</span>
        <span>{fmtClock(t.max)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Trang chính                                                        */
/* ------------------------------------------------------------------ */
export default function AlertsPage() {
  const prefs = useRef(loadPrefs()).current;

  const [widths, setWidths] = useState(() => ({ ...DEFAULT_WIDTHS, ...(prefs.widths || {}) }));
  const [hidden, setHidden] = useState(() => prefs.hidden || DEFAULT_HIDDEN);
  const [wrap, setWrap] = useState(!!prefs.wrap);
  const [pageSize, setPageSize] = useState(prefs.pageSize || 25);
  const [sort, setSort] = useState(prefs.sort || { key: 'timestamp', dir: 'desc' });

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [sevFilter, setSevFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [range, setRange] = useState(loadSharedRange);
  const [appliedRange, setAppliedRange] = useState({ from: null, to: null });

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState('overview');
  const [colMenu, setColMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ widths, hidden, wrap, pageSize, sort })); } catch (e) { /* ignore */ }
  }, [widths, hidden, wrap, pageSize, sort]);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    setError('');
    const resolved = resolveRange(range);
    fetchAlerts(page, pageSize, debouncedQ, resolved)
      .then(res => { if (id === reqId.current) { setData(res); setAppliedRange(resolved); } })
      .catch(e => { if (id === reqId.current) setError(e.message); })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  }, [page, pageSize, debouncedQ, tick, range]);

  /* ---------- dữ liệu dẫn xuất ---------- */
  const allRows = useMemo(
    () => (data?.alerts || []).map(toRow).filter(r => inRange(r.ts, appliedRange)),
    [data, appliedRange],
  );
  const rangeOn = isRangeActive(range);
  const changeRange = r => { setRange(r); saveSharedRange(r); setPage(1); };

  /* tìm kiếm trên toàn bộ JSON của cảnh báo (như bản cũ) */
  const base = useMemo(() => {
    const kw = debouncedQ.trim().toLowerCase();
    return kw ? allRows.filter(r => JSON.stringify(r.a).toLowerCase().includes(kw)) : allRows;
  }, [allRows, debouncedQ]);

  const sevCounts = useMemo(() => {
    const c = Object.fromEntries(SEVERITIES.map(sv => [sv, 0]));
    base.forEach(r => { if (c[r.sev] !== undefined) c[r.sev] += 1; });
    return c;
  }, [base]);

  const statuses = useMemo(() => [...new Set(base.map(r => r.status).filter(Boolean))], [base]);
  const hostCount = useMemo(() => new Set(base.map(r => r.a.host).filter(Boolean)).size, [base]);
  const avgRisk = useMemo(() => {
    const xs = base.map(r => r.a.risk_score).filter(v => typeof v === 'number');
    return xs.length ? Math.round(xs.reduce((p, c) => p + c, 0) / xs.length) : null;
  }, [base]);

  const filtered = useMemo(
    () => base.filter(r => (sevFilter === 'ALL' || r.sev === sevFilter) && (statusFilter === 'ALL' || r.status === statusFilter)),
    [base, sevFilter, statusFilter],
  );

  const sorted = useMemo(() => {
    const col = COLUMNS.find(c => c.key === sort.key) || COLUMNS[2];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((x, y) => {
      const a = col.sort(x);
      const b = col.sort(y);
      return (a < b ? -1 : a > b ? 1 : 0) * dir;
    });
  }, [filtered, sort]);

  const visible = useMemo(() => COLUMNS.filter(c => !hidden.includes(c.key)), [hidden]);
  const template = visible
    .map((c, i) => (i === visible.length - 1 ? `minmax(${widths[c.key]}px, 1fr)` : `${widths[c.key]}px`))
    .join(' ');
  const totalW = visible.reduce((sum, c) => sum + widths[c.key], 0);

  const total = data?.total || 0;
  const totalPages = data?.total_pages || 1;
  const filtersActive = sevFilter !== 'ALL' || statusFilter !== 'ALL' || !!debouncedQ.trim() || rangeOn;

  /* ---------- thao tác cột ---------- */
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

  const autoFit = col => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = `${CELL_FONT_PX}px ${MONO}`;
    let max = 0;
    sorted.forEach(r => { max = Math.max(max, ctx.measureText(col.text(r)).width); });
    if (col.key === 'severity' || col.key === 'status') max += 16;   // huy hiệu có viền
    if (col.key === 'risk') max += 70;                               // thanh risk
    ctx.font = `700 11px ${MONO}`;
    max = Math.max(max, ctx.measureText(col.label).width + 28);
    setWidths(w => ({ ...w, [col.key]: clampW(max + 28) }));
  };

  const toggleSort = col => {
    setSort(prev => (prev.key === col.key
      ? { key: col.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key: col.key, dir: DESC_FIRST.includes(col.key) ? 'desc' : 'asc' }));
  };

  const toggleColumn = key => {
    setHidden(h => {
      if (h.includes(key)) return h.filter(k => k !== key);
      if (visible.length <= 1) return h;
      return [...h, key];
    });
  };

  const resetColumns = () => { setWidths(DEFAULT_WIDTHS); setHidden(DEFAULT_HIDDEN); setWrap(false); setSort({ key: 'timestamp', dir: 'desc' }); };
  const clearFilters = () => { setSevFilter('ALL'); setStatusFilter('ALL'); setQ(''); setDebouncedQ(''); changeRange(DEFAULT_RANGE); };

  /* ---------- khung chi tiết ---------- */
  const openDetail = row => {
    const sel = window.getSelection && String(window.getSelection());
    if (sel && sel.length > 0) return;
    setDetail(row);
  };

  const detailIdx = detail ? sorted.findIndex(r => r.a.id === detail.a.id) : -1;
  const go = delta => {
    if (detailIdx < 0) return;
    const next = sorted[detailIdx + delta];
    if (next) setDetail(next);
  };

  useEffect(() => {
    if (!detail) return undefined;
    const onKey = e => {
      if (e.key === 'Escape') setDetail(null);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(detail.a.raw || detail.a, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) { /* ignore */ }
  };

  /* ---------- hiển thị ô ---------- */
  const renderCell = (col, r) => {
    const text = col.text(r);
    switch (col.key) {
      case 'severity':
        return <SeverityBadge sev={r.sev} />;
      case 'risk':
        return <RiskBar score={r.a.risk_score} sev={r.sev} />;
      case 'status':
        return r.status ? <StatusBadge status={r.status} /> : <span style={s.dim}>—</span>;
      case 'mitre':
        return r.mitre.length
          ? r.mitre.map((m, i) => (
            <span key={i} style={s.chipWrap}>
              <span style={s.chip}>{m.tactic?.name || '?'}</span>
              <span style={s.chipId}>{(m.technique || []).map(t => t.id).join(', ')}</span>
            </span>
          ))
          : <span style={s.dim}>—</span>;
      case 'title':
        return text ? <b style={{ fontWeight: 600 }}>{highlight(text, debouncedQ)}</b> : <span style={s.dim}>—</span>;
      default:
        return text ? highlight(text, debouncedQ) : <span style={s.dim}>—</span>;
    }
  };

  const cellStyle = (col, r) => ({
    ...s.cell,
    ...(wrap ? s.cellWrap : s.cellClip),
    ...(col.key === 'timestamp' ? { color: 'var(--text-muted)' } : null),
    ...(col.key === 'title' ? { color: 'var(--text)' } : null),
    ...(col.key === 'severity' ? { boxShadow: `inset 3px 0 0 ${sevColor(r.sev)}` } : null),
  });

  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  const source = data?.fallback ? 'alert.json (offline)' : 'Elasticsearch';

  /* ================================================================ */
  return (
    <div style={s.page}>
      <style>{CSS}</style>

      <header style={s.header}>
        <div>
          <h1 style={s.h1}>Cảnh báo bảo mật</h1>
          <p style={s.muted}>Detection alerts từ {source} · {total.toLocaleString('vi-VN')} bản ghi</p>
        </div>
        <button style={s.btnPrimary} onClick={() => setTick(t => t + 1)}>{loading ? 'Đang tải...' : 'Làm mới'}</button>
      </header>

      {error && <div style={s.error}>Không thể tải alert: {error}</div>}
      {data?.fallback && (
        <div style={s.notice}>
          ⚠ Không kết nối được máy chủ ({data.fallback_reason}). Đang hiển thị dữ liệu mẫu từ alert.json — {data.total} cảnh báo.
        </div>
      )}

      {/* ----- KPI: nhấp vào để lọc theo mức độ ----- */}
      <div style={s.kpis}>
        {SEVERITIES.map(sv => {
          const active = sevFilter === sv;
          const pct = base.length ? Math.round((sevCounts[sv] / base.length) * 100) : 0;
          return (
            <button
              key={sv}
              className="al-kpi"
              style={{ ...s.kpi, borderColor: active ? sevColor(sv) : 'var(--border)', opacity: sevCounts[sv] || active ? 1 : 0.55 }}
              onClick={() => { setSevFilter(active ? 'ALL' : sv); }}
              title={active ? 'Bỏ lọc' : `Chỉ hiện ${sv}`}
            >
              <span style={{ ...s.kpiLabel, color: sevColor(sv) }}>{sv}</span>
              <b style={s.kpiNum}>{sevCounts[sv]}</b>
              <span style={s.kpiTrack}><span style={{ ...s.kpiFill, width: `${pct}%`, background: sevColor(sv) }} /></span>
            </button>
          );
        })}
        <div style={s.stat}><span style={s.statLabel}>Host bị ảnh hưởng</span><b style={s.kpiNum}>{hostCount}</b></div>
        <div style={s.stat}><span style={s.statLabel}>Risk trung bình</span><b style={s.kpiNum}>{avgRisk ?? '—'}</b></div>
        <div style={s.stat}><span style={s.statLabel}>Tổng (toàn hệ thống)</span><b style={s.kpiNum}>{total.toLocaleString('vi-VN')}</b></div>
      </div>
      {/* <p style={s.kpiNote}>Thống kê tính trên {base.length} cảnh báo đang tải ở trang này.</p>

      <Timeline rows={base} /> */}

      {/* ----- thanh công cụ ----- */}
      <div style={s.toolbar}>
        <input
          style={s.search}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Tìm rule, mô tả, host, user, IP, MITRE..."
        />
        <TimeRangePicker value={range} onChange={changeRange} />
        <select style={s.select} value={statusFilter} onChange={e => setStatusFilter(e.target.value)} title="Lọc theo trạng thái">
          <option value="ALL">Mọi trạng thái</option>
          {statuses.map(st => <option key={st} value={st}>{STATUS_LABEL[st] || st}</option>)}
        </select>
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
                    <input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                    {c.label}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <button style={s.btn} onClick={resetColumns} title="Đặt lại độ rộng, cột hiển thị và sắp xếp">Đặt lại cột</button>
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
        <span>
          Hiển thị <b>{sorted.length}</b> / {allRows.length} cảnh báo trên trang này
          {' '}(<b>{from}–{to}</b> / {total.toLocaleString('vi-VN')} toàn hệ thống)
          {filtersActive && <button style={s.linkBtn} onClick={clearFilters}>Xóa bộ lọc</button>}
        </span>
        <span style={s.hint}>Nhấp tiêu đề để sắp xếp · Kéo mép cột để đổi độ rộng · Nhấp đúp mép cột để tự khớp</span>
      </div>

      {/* ----- bảng ----- */}
      <section className="al-scroll" style={{ ...s.scroll, opacity: loading && data ? 0.6 : 1 }}>
        <div style={{ minWidth: totalW }}>
          <div style={{ ...s.head, gridTemplateColumns: template }}>
            {visible.map(c => (
              <div key={c.key} className="al-hcell" style={s.hcell}>
                <span className="al-hlabel" style={s.hlabel} onClick={() => toggleSort(c)} title="Nhấp để sắp xếp">
                  {c.label}
                  {sort.key === c.key && <span style={s.sortMark}>{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
                </span>
                <span
                  className="al-resizer"
                  onMouseDown={e => startResize(e, c.key)}
                  onDoubleClick={() => autoFit(c)}
                  title="Kéo để đổi độ rộng · Nhấp đúp để tự khớp nội dung"
                />
              </div>
            ))}
          </div>

          {loading && !data && <div style={s.empty}>Đang tải dữ liệu cảnh báo...</div>}
          {!loading && !sorted.length && (
            <div style={s.empty}>
              Không có cảnh báo phù hợp{rangeOn ? ' trong khoảng thời gian đã chọn' : ''}.
              {rangeOn && <button style={s.linkBtn} onClick={() => changeRange(DEFAULT_RANGE)}>Xem tất cả thời gian</button>}
            </div>
          )}

          {sorted.map((r, i) => (
            <div key={r.a.id || i} className="al-row" style={{ ...s.row, gridTemplateColumns: template }} onClick={() => openDetail(r)}>
              {visible.map(c => (
                <div key={c.key} style={cellStyle(c, r)} title={wrap ? undefined : c.text(r)}>
                  {renderCell(c, r)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

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
            <div style={s.drawerTop}>
              <div style={s.nav}>
                <button style={s.btn} disabled={detailIdx <= 0} onClick={() => go(-1)} title="Cảnh báo trước (←)">◀</button>
                <span style={s.muted}>{detailIdx >= 0 ? `${detailIdx + 1} / ${sorted.length}` : '—'}</span>
                <button style={s.btn} disabled={detailIdx < 0 || detailIdx >= sorted.length - 1} onClick={() => go(1)} title="Cảnh báo sau (→)">▶</button>
              </div>
              <button style={s.close} onClick={() => setDetail(null)} aria-label="Đóng">×</button>
            </div>

            <div style={s.dHead}>
              <SeverityBadge sev={detail.sev} />
              <StatusBadge status={detail.status} />
              <RiskBar score={detail.a.risk_score} sev={detail.sev} />
            </div>
            <h2 style={s.dTitle}>{detail.a.title || 'Alert detail'}</h2>
            <p style={s.muted}>{fmtTime(detail.a.timestamp)}{detail.a.host ? ` · ${detail.a.host}` : ''}</p>

            <div style={s.tabs}>
              {[['overview', 'Tổng quan'], ['mitre', `MITRE ATT&CK (${detail.mitre.length})`], ['rule', 'Rule'], ['raw', 'Raw JSON']].map(([k, label]) => (
                <button key={k} style={{ ...s.tab, ...(tab === k ? s.tabActive : null) }} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>

            {tab === 'overview' && (
              <>
                <h3 style={s.h3}>Lý do cảnh báo</h3>
                <pre style={s.msgBox}>{detail.reason || detail.a.description || 'Không có mô tả.'}</pre>
                {detail.a.description && detail.reason && detail.a.description !== detail.reason && (
                  <>
                    <h3 style={s.h3}>Mô tả</h3>
                    <pre style={s.msgBox}>{detail.a.description}</pre>
                  </>
                )}
                {detail.a.recommendation && (
                  <>
                    <h3 style={s.h3}>Khuyến nghị xử lý</h3>
                    <pre style={s.msgBox}>{detail.a.recommendation}</pre>
                  </>
                )}
                <h3 style={s.h3}>Thông tin sự kiện</h3>
                <dl style={s.dl}>
                  {[
                    ['Host', detail.a.host], ['User', detail.a.user], ['Source IP', detail.srcIp],
                    ['Action', detail.action], ['Outcome', detail.outcome], ['Dataset', detail.dataset],
                    ['Category', detail.a.category], ['Alert ID', detail.a.id],
                  ].map(([k, v]) => (
                    <React.Fragment key={k}>
                      <dt style={s.dt}>{k}</dt>
                      <dd style={s.dd}>{v || <span style={s.dim}>—</span>}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </>
            )}

            {tab === 'mitre' && (
              !detail.mitre.length
                ? <div style={s.empty}>Rule này không gắn kỹ thuật MITRE ATT&CK.</div>
                : detail.mitre.map((m, i) => (
                  <div key={i} style={s.tactic}>
                    <div style={s.tacticHead}>
                      <span style={s.chipId}>{m.tactic?.id}</span>
                      {isUrl(m.tactic?.reference)
                        ? <a href={m.tactic.reference} target="_blank" rel="noopener noreferrer" style={s.link}>{m.tactic?.name}</a>
                        : <b>{m.tactic?.name}</b>}
                      <span style={s.dim}>Tactic</span>
                    </div>
                    {(m.technique || []).map(t => (
                      <div key={t.id} style={s.tech}>
                        <div>
                          <span style={s.chipId}>{t.id}</span>{' '}
                          {isUrl(t.reference) ? <a href={t.reference} target="_blank" rel="noopener noreferrer" style={s.link}>{t.name}</a> : t.name}
                        </div>
                        {(t.subtechnique || []).map(st => (
                          <div key={st.id} style={s.subtech}>
                            <span style={s.chipId}>{st.id}</span>{' '}
                            {isUrl(st.reference) ? <a href={st.reference} target="_blank" rel="noopener noreferrer" style={s.link}>{st.name}</a> : st.name}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))
            )}

            {tab === 'rule' && (
              <>
                <dl style={s.dl}>
                  {[
                    ['Tên rule', detail.a.title], ['Rule ID', detail.a.rule_id], ['Loại', detail.a.rule_type],
                    ['Risk score', asText(detail.a.risk_score)],
                    ['Chu kỳ chạy', detail.interval && `${detail.interval} (quét từ ${detail.from || '?'})`],
                    ['Index nguồn', detail.indices.join(', ')],
                  ].map(([k, v]) => (
                    <React.Fragment key={k}>
                      <dt style={s.dt}>{k}</dt>
                      <dd style={s.dd}>{v || <span style={s.dim}>—</span>}</dd>
                    </React.Fragment>
                  ))}
                </dl>
                {!!detail.tags.length && (
                  <>
                    <h3 style={s.h3}>Tags</h3>
                    <div style={s.tagList}>{detail.tags.map(t => <span key={t} style={s.tag}>{t}</span>)}</div>
                  </>
                )}
                {!!detail.falsePositives.length && (
                  <>
                    <h3 style={s.h3}>Dương tính giả thường gặp</h3>
                    <ul style={s.ul}>{detail.falsePositives.map((f, i) => <li key={i}>{f}</li>)}</ul>
                  </>
                )}
                {!!detail.references.length && (
                  <>
                    <h3 style={s.h3}>Tham khảo</h3>
                    <ul style={s.ul}>
                      {detail.references.map((u, i) => (
                        <li key={i}>{isUrl(u) ? <a href={u} target="_blank" rel="noopener noreferrer" style={s.link}>{u}</a> : u}</li>
                      ))}
                    </ul>
                  </>
                )}
                {detail.note && (
                  <>
                    <h3 style={s.h3}>Hướng dẫn điều tra (triage)</h3>
                    <pre style={s.msgBox}>{detail.note}</pre>
                  </>
                )}
              </>
            )}

            {tab === 'raw' && (
              <>
                <div style={s.rawHead}>
                  <h3 style={{ ...s.h3, margin: 0 }}>Raw Elasticsearch alert</h3>
                  <button style={s.btn} onClick={copyJson}>{copied ? 'Đã copy ✓' : 'Copy'}</button>
                </div>
                <pre style={s.raw}>{JSON.stringify(detail.a.raw || detail.a, null, 2)}</pre>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Style                                                              */
/* ------------------------------------------------------------------ */
const CSS = `
.al-row { cursor: pointer; }
.al-row:hover { background: var(--surface-2); }
.al-kpi { cursor: pointer; }
.al-kpi:hover { background: var(--surface-2); }
.al-hcell { position: relative; }
.al-hlabel { cursor: pointer; }
.al-hlabel:hover { color: var(--text); }
.al-resizer { position: absolute; top: 0; right: -4px; width: 9px; height: 100%; cursor: col-resize; z-index: 3; }
.al-resizer::after { content: ''; position: absolute; left: 4px; top: 22%; height: 56%; width: 1px; background: var(--border); }
.al-hcell:hover .al-resizer::after, .al-resizer:hover::after { background: var(--accent); width: 2px; left: 3px; }
`;

const s = {
  page: { color: 'var(--text)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  h1: { margin: 0, fontSize: 24 },
  h3: { fontSize: 12, margin: '18px 0 8px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 },
  muted: { color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 0' },

  btnPrimary: { background: 'var(--success-strong)', color: '#fff', border: 0, borderRadius: 6, padding: '9px 16px', cursor: 'pointer' },
  btn: { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', cursor: 'pointer', fontSize: 13 },
  linkBtn: { background: 'none', border: 0, color: 'var(--accent-text)', cursor: 'pointer', fontSize: 12, marginLeft: 8, textDecoration: 'underline' },
  select: { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 13 },
  check: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap', cursor: 'pointer' },

  error: { background: 'var(--danger-bg)', color: 'var(--danger-text)', padding: 12, borderRadius: 6, marginBottom: 12 },
  notice: { background: 'var(--warning-bg)', color: 'var(--warning)', border: '1px solid var(--warning-border)', padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 13 },

  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 10, marginBottom: 6 },
  kpi: { textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--surface)', color: 'var(--text)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 8, padding: '10px 12px' },
  kpiLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 0.5 },
  kpiNum: { fontSize: 24, lineHeight: 1.1 },
  kpiTrack: { height: 3, background: 'var(--surface-2)', borderRadius: 2, overflow: 'hidden' },
  kpiFill: { display: 'block', height: '100%' },
  stat: { display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: 8, padding: '10px 12px' },
  statLabel: { fontSize: 11, color: 'var(--text-muted)' },
  kpiNote: { fontSize: 11, color: 'var(--text-muted)', margin: '0 0 14px' },

  timeline: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px 8px', marginBottom: 14 },
  timelineHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 6, flexWrap: 'wrap', gap: 8 },
  legend: { display: 'flex', gap: 12, color: 'var(--text-muted)', fontSize: 11 },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 2, display: 'inline-block' },
  svg: { width: '100%', height: 76, display: 'block' },
  axis: { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 4, fontFamily: MONO },

  toolbar: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 },
  search: { flex: 1, minWidth: 260, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px' },
  status: { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 },
  hint: { fontStyle: 'italic' },

  menuBackdrop: { position: 'fixed', inset: 0, zIndex: 15 },
  menu: { position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 16, minWidth: 190, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 6, boxShadow: '0 8px 24px rgba(0,0,0,.35)' },
  menuItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer', borderRadius: 4 },

  scroll: { border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', overflow: 'auto', maxHeight: 'calc(100vh - 260px)', minHeight: 240, transition: 'opacity .15s' },
  head: { display: 'grid', position: 'sticky', top: 0, zIndex: 5, background: 'var(--surface)', borderBottom: '1px solid var(--border)' },
  hcell: { padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: 'var(--text-muted)', textTransform: 'uppercase', minWidth: 0, display: 'flex', alignItems: 'center' },
  hlabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 6, userSelect: 'none' },
  sortMark: { color: 'var(--accent)' },

  row: { display: 'grid', borderBottom: '1px solid var(--surface-2)' },
  cell: { padding: '8px 12px', fontFamily: MONO, fontSize: CELL_FONT_PX, lineHeight: 1.6, minWidth: 0, color: 'var(--text-secondary)', borderRight: '1px solid var(--surface-2)' },
  cellClip: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cellWrap: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  dim: { color: 'var(--text-muted)', opacity: 0.5 },
  mark: { background: 'var(--warning)', color: '#000', borderRadius: 2, padding: '0 1px' },
  badge: { display: 'inline-block', border: '1px solid', borderRadius: 4, padding: '0 6px', fontSize: 10, fontWeight: 700, lineHeight: '16px', whiteSpace: 'nowrap' },
  riskWrap: { display: 'inline-flex', alignItems: 'center', gap: 8, width: '100%' },
  riskNum: { minWidth: 22, textAlign: 'right', color: 'var(--text)' },
  riskTrack: { flex: 1, minWidth: 20, height: 6, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' },
  riskFill: { display: 'block', height: '100%' },
  chipWrap: { display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 8 },
  chip: { background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '0 6px', fontSize: 11 },
  chipId: { color: 'var(--accent-text)', fontSize: 11, fontFamily: MONO },
  empty: { padding: 60, textAlign: 'center', color: 'var(--text-muted)' },

  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: 20, flexWrap: 'wrap' },

  overlay: { position: 'fixed', inset: 0, background: 'var(--overlay)', zIndex: 20 },
  drawer: { position: 'absolute', right: 0, top: 0, height: '100%', width: 'min(780px, 94vw)', background: 'var(--surface)', padding: 24, overflow: 'auto', boxSizing: 'border-box' },
  drawerTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  nav: { display: 'flex', alignItems: 'center', gap: 10 },
  close: { background: 'none', border: 0, color: 'var(--text-muted)', fontSize: 28, cursor: 'pointer', lineHeight: 1 },
  dHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  dTitle: { margin: '0 0 4px', fontSize: 20 },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', margin: '16px 0 4px', flexWrap: 'wrap' },
  tab: { background: 'none', border: 0, borderBottomWidth: 2, borderBottomStyle: 'solid', borderBottomColor: 'transparent', color: 'var(--text-muted)', padding: '8px 12px', cursor: 'pointer', fontSize: 13 },
  tabActive: { color: 'var(--text)', borderBottomColor: 'var(--accent)' },

  dl: { display: 'grid', gridTemplateColumns: '130px 1fr', gap: '6px 14px', margin: 0, fontSize: 13 },
  dt: { color: 'var(--text-muted)' },
  dd: { margin: 0, fontFamily: MONO, fontSize: 12, wordBreak: 'break-all' },
  msgBox: { background: 'var(--bg)', padding: 12, borderRadius: 6, fontFamily: MONO, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, lineHeight: 1.55 },
  rawHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '14px 0 8px' },
  raw: { background: 'var(--bg)', padding: 14, color: 'var(--text-secondary)', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word', borderRadius: 6, margin: 0 },

  tactic: { border: '1px solid var(--border)', borderRadius: 8, padding: 12, margin: '12px 0', background: 'var(--bg)' },
  tacticHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 },
  tech: { margin: '8px 0 0 12px', fontSize: 13 },
  subtech: { margin: '4px 0 0 18px', fontSize: 12, color: 'var(--text-secondary)' },
  link: { color: 'var(--accent-text)' },
  tagList: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  tag: { background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px', fontSize: 11 },
  ul: { margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, wordBreak: 'break-all' },
};