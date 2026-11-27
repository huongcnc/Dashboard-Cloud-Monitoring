import fallbackLogs from '../logs.json';
import fallbackAlerts from '../alert.json';
import { inRange } from './timeRange';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// Quá thời gian này mà backend chưa trả lời thì coi như lỗi và chuyển sang dữ liệu JSON cục bộ
const FETCH_TIMEOUT_MS = 5000;

// fetch + timeout, ném lỗi nếu mạng hỏng / quá hạn / HTTP không OK
async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    return await res.json();
  } catch (err) {
    throw err.name === 'AbortError' ? new Error('Quá thời gian chờ máy chủ') : err;
  } finally {
    clearTimeout(timer);
  }
}

// logs.json / alert.json chỉ là 1 trang snapshot nên phải tự tìm kiếm + phân trang lại
// (không dùng total / total_pages ghi sẵn trong file vì chúng là của toàn bộ Elasticsearch)
function paginateLocal(items, { page, pageSize, query, range, listKey, reason }) {
  const kw = (query || '').trim().toLowerCase();
  const inTime = items.filter(item => inRange(new Date(item.timestamp).getTime(), range));
  const filtered = kw
    ? inTime.filter(item => JSON.stringify(item).toLowerCase().includes(kw))
    : inTime;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    total,
    page: safePage,
    page_size: pageSize,
    total_pages: totalPages,
    [listKey]: filtered.slice(start, start + pageSize),
    source: 'local-json',
    fallback: true,           // để trang biết mà hiện banner
    fallback_reason: reason,
  };
}

// === Logs & Alerts (cu) ===
// range = { from: Date|null, to: Date|null } -> &from=...&to=... (ISO-8601, UTC)
function rangeParams(range) {
  let qs = '';
  if (range?.from) qs += `&from=${encodeURIComponent(range.from.toISOString())}`;
  if (range?.to) qs += `&to=${encodeURIComponent(range.to.toISOString())}`;
  return qs;
}

export async function fetchLogs(page = 1, pageSize = 50, query = '', range = null) {
  try {
    return await fetchJson(`${BASE_URL}/logs?page=${page}&page_size=${pageSize}&q=${encodeURIComponent(query)}${rangeParams(range)}`);
  } catch (err) {
    console.warn('[fetchLogs] Không lấy được từ API, dùng logs.json:', err.message);
    return paginateLocal(fallbackLogs.logs || [], {
      page, pageSize, query, range, listKey: 'logs', reason: err.message,
    });
  }
}

export async function fetchAlerts(page = 1, pageSize = 50, query = '', range = null) {
  try {
    return await fetchJson(`${BASE_URL}/api/alerts?page=${page}&page_size=${pageSize}&q=${encodeURIComponent(query)}${rangeParams(range)}`);
  } catch (err) {
    console.warn('[fetchAlerts] Không lấy được từ API, dùng alert.json:', err.message);
    return paginateLocal(fallbackAlerts.alerts || [], {
      page, pageSize, query, range, listKey: 'alerts', reason: err.message,
    });
  }
}

export async function checkHealth() {
  const res = await fetch(`${BASE_URL}/health`);
  return res.ok;
}

// === Customer: nhap AWS key ===
export async function setupCustomer({ customer_id, aws_access_key_id, aws_secret_access_key, aws_region, schedule }) {
  const res = await fetch(`${BASE_URL}/api/customer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer_id, aws_access_key_id, aws_secret_access_key, aws_region, schedule }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Server error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function removeCustomer(customer_id) {
  const res = await fetch(`${BASE_URL}/api/customer/${customer_id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

// === Scan trigger: goi pipeline ===
export async function triggerScan(customer_id, scan_regions = 'auto') {
  const res = await fetch(`${BASE_URL}/api/scan/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer_id, scan_regions }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Server error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getScanStatus(run_id) {
  const res = await fetch(`${BASE_URL}/api/scan/status/${run_id}`);
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

// === Results: doc tu S3 ===
export async function fetchLatestResults(customer_id) {
  const res = await fetch(`${BASE_URL}/api/results/${customer_id}/latest`);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Server error ${res.status}`);
  }
  return res.json();
}

export async function fetchHistory(customer_id) {
  const res = await fetch(`${BASE_URL}/api/results/${customer_id}/history`);
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

export async function fetchHistoryDetail(customer_id, timestamp) {
  const res = await fetch(`${BASE_URL}/api/results/${customer_id}/history/${encodeURIComponent(timestamp)}`);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Server error ${res.status}`);
  }
  return res.json();
}

// === AI (Tang 2): tong quan + khuyen nghi ===
export async function getAIStatus() {
  const res = await fetch(`${BASE_URL}/api/ai/status`);
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

export async function analyzeWithAI(customer_id, force = false) {
  const res = await fetch(`${BASE_URL}/api/ai/analyze/${customer_id}?force=${force ? 'true' : 'false'}`, {
    method: 'POST',
  });
  if (!res.ok) {
    let detail = `Server error ${res.status}`;
    try {
      const body = await res.json();
      if (body.detail) detail = body.detail;
    } catch (e) { /* ignore */ }
    throw new Error(detail);
  }
  return res.json();
}

// === Scan file (cu, giu lai) ===
export async function scanFile(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE_URL}/scan`, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Server error ${res.status}: ${text}`);
  }
  return res.json();
}