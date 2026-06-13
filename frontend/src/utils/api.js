const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

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

export async function fetchLogs() {
  const res = await fetch(`${BASE_URL}/logs`);
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json(); // { total, logs: [{timestamp, host, service, pid, message}] }
}

export async function fetchAlerts() {
  const res = await fetch(`${BASE_URL}/api/alerts`);
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json(); // { alerts: [{timestamp, severity, category, title, description, recommendation}] }
}

export async function checkHealth() {
  const res = await fetch(`${BASE_URL}/health`);
  return res.ok;
}
