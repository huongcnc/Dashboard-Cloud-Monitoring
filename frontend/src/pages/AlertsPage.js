import React, { useState, useEffect, useCallback } from 'react';
import { fetchAlerts } from '../utils/api';
import SeverityBadge from '../components/SeverityBadge';
import { SEVERITY_CONFIG } from '../constants';

/* ── Stat card ── */
function StatCard({ label, value, color }) {
  return (
    <div style={{
      background: '#0d1117', border: '1px solid #30363d',
      borderRadius: 8, padding: '12px 16px', textAlign: 'center', minWidth: 90,
    }}>
      <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>{label}</div>
    </div>
  );
}

/* ── Alert card ── */
function AlertCard({ alert, isOpen, onToggle }) {
  const cfg = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.INFO;
  return (
    <div
      onClick={onToggle}
      style={{
        background: '#161b22',
        border: `1px solid ${isOpen ? cfg.color : '#30363d'}`,
        borderLeft: `3px solid ${cfg.color}`,
        borderRadius: 10,
        padding: '14px 16px',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <SeverityBadge severity={alert.severity} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3' }}>
            {alert.title}
          </div>
          <div style={{ fontSize: 12, color: '#8b949e', marginTop: 3, display: 'flex', gap: 12 }}>
            <span>🕐 {alert.timestamp}</span>
            {alert.category && <span>📁 {alert.category}</span>}
          </div>
        </div>

        <span style={{ color: '#8b949e', fontSize: 13, flexShrink: 0 }}>
          {isOpen ? '▲' : '▼'}
        </span>
      </div>

      {/* Detail */}
      {isOpen && (
        <div style={{
          marginTop: 14, paddingTop: 14,
          borderTop: '1px solid #21262d',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {/* Description */}
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Mô tả
            </div>
            <p style={{ margin: 0, fontSize: 13, color: '#c9d1d9', lineHeight: 1.65 }}>
              {alert.description}
            </p>
          </div>

          {/* Recommendation */}
          {alert.recommendation && (
            <div style={{
              background: '#0d2a1a', border: '1px solid #3fb95044',
              borderRadius: 8, padding: '10px 14px',
            }}>
              <div style={{ fontSize: 11, color: '#3fb950', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
                💡 Khuyến nghị
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#c9d1d9', lineHeight: 1.6 }}>
                {alert.recommendation}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const SAMPLE_ALERTS = {
  alerts: [
    {
      timestamp: 'May 23 14:21:12',
      severity: 'HIGH',
      category: 'SSH Brute Force',
      title: 'SSH Brute Force Attempt Detected',
      description: 'Multiple failed SSH login attempts from 203.0.113.45 using invalid user "admin". The pattern suggests an automated brute-force attack targeting port 22.',
      recommendation: 'Block IP 203.0.113.45 via UFW: `ufw deny from 203.0.113.45`. Consider enabling fail2ban to auto-block repeated failures.',
    },
    {
      timestamp: 'May 23 14:21:48',
      severity: 'HIGH',
      category: 'Privilege Escalation',
      title: 'Sudo Privilege Escalation by devops',
      description: 'User "devops" used sudo to run /usr/bin/systemctl as root. While this may be legitimate, escalation should be audited regularly.',
      recommendation: 'Review sudoers file and restrict commands to only what is necessary. Enable sudo logging.',
    },
    {
      timestamp: 'May 23 14:21:09',
      severity: 'MEDIUM',
      category: 'Firewall / Network Block',
      title: 'UFW Blocked Inbound Connection',
      description: 'Kernel UFW blocked inbound TCP traffic from 192.168.1.15 to port 22 (SSH). Repeated blocks from this source may indicate a scan.',
      recommendation: 'Monitor the source IP for repeated attempts and consider adding a permanent block rule.',
    },
  ],
};

export default function AlertsPage() {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [openIndex,   setOpenIndex]   = useState(null);
  const [sevFilter,   setSevFilter]   = useState('ALL');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [aiLoading,   setAiLoading]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setAiLoading(true);
    setError(null);
    try {
      const result = await fetchAlerts();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.message);
      setData(SAMPLE_ALERTS);
    } finally {
      setLoading(false);
      setAiLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const alerts = data?.alerts || [];

  /* counts per severity */
  const counts = alerts.reduce((acc, a) => {
    acc[a.severity] = (acc[a.severity] || 0) + 1;
    return acc;
  }, {});

  const filtered = alerts.filter(a =>
    sevFilter === 'ALL' || a.severity === sevFilter
  );

  const severities = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Header ── */}
      <div style={{
        background: '#161b22', border: '1px solid #30363d',
        borderRadius: 12, padding: '16px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e6edf3', display: 'flex', alignItems: 'center', gap: 8 }}>
            Cảnh báo bảo mật
            {aiLoading && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: '#1f6feb22', color: '#388bfd', border: '1px solid #388bfd44' }}>
                ✨ AI đang phân tích...
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#8b949e', marginTop: 2 }}>
            Phân tích bởi CrewAI + Gemini · {alerts.length} cảnh báo
            {lastRefresh && ` · ${lastRefresh.toLocaleTimeString('vi-VN')}`}
          </div>
        </div>
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
          {loading ? '✨ Đang phân tích...' : '✨ Phân tích lại'}
        </button>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{
          background: '#3d1515', border: '1px solid #f85149',
          borderRadius: 8, padding: '10px 16px', fontSize: 13, color: '#ffa198',
          display: 'flex', gap: 8, alignItems: 'center',
        }}>
          ⚠ {error} — hiển thị dữ liệu demo.
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#ffa198', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* ── Stat row ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StatCard label="Tổng"     value={alerts.length}          color="#e6edf3" />
        <StatCard label="Critical" value={counts.CRITICAL || 0}   color={SEVERITY_CONFIG.CRITICAL.color} />
        <StatCard label="High"     value={counts.HIGH     || 0}   color={SEVERITY_CONFIG.HIGH.color}     />
        <StatCard label="Medium"   value={counts.MEDIUM   || 0}   color={SEVERITY_CONFIG.MEDIUM.color}   />
        <StatCard label="Low"      value={counts.LOW      || 0}   color={SEVERITY_CONFIG.LOW.color}      />
        <StatCard label="Info"     value={counts.INFO     || 0}   color={SEVERITY_CONFIG.INFO.color}     />
      </div>

      {/* ── Filter ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {severities.map(sv => {
          const cfg = SEVERITY_CONFIG[sv];
          const isActive = sevFilter === sv;
          const cnt = sv === 'ALL' ? alerts.length : (counts[sv] || 0);
          return (
            <button key={sv} onClick={() => { setSevFilter(sv); setOpenIndex(null); }} style={{
              padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s',
              background: isActive ? (cfg?.color || '#388bfd') : '#161b22',
              color: isActive ? '#fff' : '#8b949e',
              border: `1px solid ${isActive ? (cfg?.color || '#388bfd') : '#30363d'}`,
            }}>
              {sv === 'ALL' ? `Tất cả (${cnt})` : `${cfg?.label} (${cnt})`}
            </button>
          );
        })}
      </div>

      {/* ── Alerts list ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && !data && (
          <div style={{
            background: '#161b22', border: '1px solid #30363d',
            borderRadius: 12, padding: '64px 24px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✨</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#e6edf3', marginBottom: 6 }}>
              CrewAI đang phân tích log...
            </div>
            <div style={{ fontSize: 13, color: '#8b949e' }}>
              Parser Agent → Security Analyst Agent đang hoạt động
            </div>
          </div>
        )}

        {!loading && filtered.length === 0 && data && (
          <div style={{
            background: '#161b22', border: '1px solid #30363d',
            borderRadius: 12, padding: '48px 24px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#3fb950', marginBottom: 4 }}>
              Không phát hiện mối đe dọa
            </div>
            <div style={{ fontSize: 13, color: '#8b949e' }}>
              Không có cảnh báo nào trong bộ lọc hiện tại.
            </div>
          </div>
        )}

        {filtered.map((alert, i) => (
          <AlertCard
            key={i}
            alert={alert}
            isOpen={openIndex === i}
            onToggle={() => setOpenIndex(openIndex === i ? null : i)}
          />
        ))}
      </div>

      {/* ── AI attribution ── */}
      <div style={{ fontSize: 11, color: '#484f58', textAlign: 'center', paddingBottom: 8 }}>
        Phân tích bởi CrewAI Multi-Agent Pipeline · Gemini 2.5-flash → 2.0-flash → 1.5-flash (fallback)
      </div>
    </div>
  );
}
