const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// === Logs & Alerts (cu) ===
export async function fetchLogs(page = 1, pageSize = 50, query = '') {
  const res = await fetch(`${BASE_URL}/logs?page=${page}&page_size=${pageSize}&q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

export async function fetchAlerts(page = 1, pageSize = 50, query = '') {
  const res = await fetch(`${BASE_URL}/api/alerts?page=${page}&page_size=${pageSize}&q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
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
