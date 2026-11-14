import React, { useState } from 'react';
import { SEVERITY_CONFIG } from '../constants';
import SeverityBadge from '../components/SeverityBadge';

function Tag({ label }) {
  return (
    <span style={{
      fontSize: 11, padding: '3px 8px', borderRadius: 4,
      background: 'var(--surface-2)', color: 'var(--text-muted)',
      border: '1px solid var(--border)',
    }}>
      {label}
    </span>
  );
}

function FindingDetail({ finding }) {
  return (
    <div style={{
      marginTop: 14, paddingTop: 14,
      borderTop: '1px solid var(--surface-2)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
        {finding.description}
      </p>

      {(finding.expected_value || finding.actual_value) && (
        <div style={{
          background: 'var(--bg)', borderRadius: 6,
          padding: '10px 14px', fontSize: 12,
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {finding.expected_value && (
            <div>
              <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ Mong đợi: </span>
              <span style={{ color: 'var(--text-secondary)' }}>{finding.expected_value}</span>
            </div>
          )}
          {finding.actual_value && (
            <div>
              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>✗ Thực tế: </span>
              <span style={{ color: 'var(--text-secondary)' }}>{finding.actual_value}</span>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {finding.category    && <Tag label={`📁 ${finding.category}`}   />}
        {finding.platform    && <Tag label={`⚙ ${finding.platform}`}    />}
        {finding.cwe         && <Tag label={`🔒 CWE-${finding.cwe}`}    />}
        {finding.risk_score  && <Tag label={`⚡ Risk: ${finding.risk_score}`} />}
        {finding.resource_type && <Tag label={finding.resource_type}    />}
      </div>
    </div>
  );
}

/* Phan loai nguon cua finding: IaC (KICS) / Secret / Image (CVE) */
const SOURCES = [
  { key: 'ALL',    label: 'Tất cả nguồn' },
  { key: 'IAC',    label: 'IaC (KICS)' },
  { key: 'SECRET', label: 'Secret' },
  { key: 'IMAGE',  label: 'Image (CVE)' },
];

function sourceOf(f) {
  if (f.platform === 'trivy-image' || f.resource_type === 'container-image' || f.category === 'Vulnerability') return 'IMAGE';
  if (f.category === 'Secret' || (f.source === 'trivy' && f.platform === 'trivy')) return 'SECRET';
  return 'IAC';
}

export default function ScanPage({ data }) {
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [openIndex, setOpenIndex] = useState(null);
  const [search, setSearch] = useState('');

  const severities = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  const allFindings = data.findings || [];

  const sourceCounts = SOURCES.reduce((acc, src) => {
    acc[src.key] = src.key === 'ALL'
      ? allFindings.length
      : allFindings.filter(f => sourceOf(f) === src.key).length;
    return acc;
  }, {});

  /* So dem muc do theo nguon dang chon */
  const bySource = sourceFilter === 'ALL'
    ? allFindings
    : allFindings.filter(f => sourceOf(f) === sourceFilter);
  const counts = severities.reduce((acc, sv) => {
    acc[sv] = sv === 'ALL' ? bySource.length : bySource.filter(f => f.severity === sv).length;
    return acc;
  }, {});

  const filtered = bySource.filter(f => {
    const matchSev = severityFilter === 'ALL' || f.severity === severityFilter;
    const q = search.toLowerCase();
    const matchSearch = !q ||
      f.query_name?.toLowerCase().includes(q) ||
      f.file?.toLowerCase().includes(q) ||
      f.category?.toLowerCase().includes(q) ||
      f.resource_name?.toLowerCase().includes(q);
    return matchSev && matchSearch;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Source filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {SOURCES.map(src => {
          const isActive = sourceFilter === src.key;
          return (
            <button
              key={src.key}
              onClick={() => { setSourceFilter(src.key); setOpenIndex(null); }}
              style={{
                padding: '5px 14px', borderRadius: 6,
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.15s',
                background: isActive ? 'var(--accent)' : 'var(--surface)',
                color: isActive ? '#fff' : 'var(--text-muted)',
                border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
              }}
            >
              {`${src.label} (${sourceCounts[src.key]})`}
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {severities.map(sv => {
          const cfg = SEVERITY_CONFIG[sv];
          const isActive = severityFilter === sv;
          return (
            <button
              key={sv}
              onClick={() => { setSeverityFilter(sv); setOpenIndex(null); }}
              style={{
                padding: '5px 14px', borderRadius: 6,
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.15s',
                background: isActive ? (cfg?.color || 'var(--accent)') : 'var(--surface)',
                color: isActive ? '#fff' : 'var(--text-muted)',
                border: `1px solid ${isActive ? (cfg?.color || 'var(--accent)') : 'var(--border)'}`,
              }}
            >
              {sv === 'ALL' ? `Tất cả (${counts.ALL})` : `${cfg?.label} (${counts[sv]})`}
            </button>
          );
        })}

        {/* Search */}
        <input
          type="text"
          placeholder="🔍 Tìm kiếm..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            marginLeft: 'auto', padding: '5px 12px',
            borderRadius: 6, border: '1px solid var(--border)',
            background: 'var(--surface)', color: 'var(--text)',
            fontSize: 12, outline: 'none', width: 200,
          }}
        />
      </div>

      {/* Result count */}
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Hiển thị {filtered.length} / {allFindings.length} lỗ hổng
      </div>

      {/* Findings list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '48px 0',
            color: 'var(--text-muted)', fontSize: 14,
          }}>
            Không tìm thấy lỗ hổng nào.
          </div>
        )}

        {filtered.map((f, i) => {
          const isOpen = openIndex === i;
          return (
            <div
              key={i}
              onClick={() => setOpenIndex(isOpen ? null : i)}
              style={{
                background: 'var(--surface)',
                border: `1px solid ${isOpen ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 10,
                padding: '14px 16px',
                cursor: 'pointer',
                transition: 'border-color 0.15s',
              }}
            >
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <SeverityBadge severity={f.severity} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                    {f.query_name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                    {f.file}
                    {f.line != null ? ` · dòng ${f.line}` : ''}
                    {f.resource_type ? ` · ${f.resource_type}` : ''}
                    {f.resource_name ? `/${f.resource_name}` : ''}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  <span style={{
                    fontSize: 11, background: 'var(--surface-2)',
                    borderRadius: 4, padding: '2px 8px', color: 'var(--text-muted)',
                  }}>
                    {f.cloud_provider}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {isOpen ? '▲' : '▼'}
                  </span>
                </div>
              </div>

              {/* Detail */}
              {isOpen && <FindingDetail finding={f} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
