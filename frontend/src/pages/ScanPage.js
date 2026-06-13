import React, { useState } from 'react';
import { SEVERITY_CONFIG } from '../constants';
import SeverityBadge from '../components/SeverityBadge';

function Tag({ label }) {
  return (
    <span style={{
      fontSize: 11, padding: '3px 8px', borderRadius: 4,
      background: '#21262d', color: '#8b949e',
      border: '1px solid #30363d',
    }}>
      {label}
    </span>
  );
}

function FindingDetail({ finding }) {
  return (
    <div style={{
      marginTop: 14, paddingTop: 14,
      borderTop: '1px solid #21262d',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <p style={{ margin: 0, fontSize: 13, color: '#c9d1d9', lineHeight: 1.65 }}>
        {finding.description}
      </p>

      {(finding.expected_value || finding.actual_value) && (
        <div style={{
          background: '#0d1117', borderRadius: 6,
          padding: '10px 14px', fontSize: 12,
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {finding.expected_value && (
            <div>
              <span style={{ color: '#3fb950', fontWeight: 600 }}>✓ Mong đợi: </span>
              <span style={{ color: '#c9d1d9' }}>{finding.expected_value}</span>
            </div>
          )}
          {finding.actual_value && (
            <div>
              <span style={{ color: '#f85149', fontWeight: 600 }}>✗ Thực tế: </span>
              <span style={{ color: '#c9d1d9' }}>{finding.actual_value}</span>
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

export default function ScanPage({ data }) {
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [openIndex, setOpenIndex] = useState(null);
  const [search, setSearch] = useState('');

  const s = data.summary;
  const severities = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

  const counts = {
    ALL:      (data.findings || []).length,
    CRITICAL: s.critical || 0,
    HIGH:     s.high     || 0,
    MEDIUM:   s.medium   || 0,
    LOW:      s.low      || 0,
    INFO:     s.info     || 0,
  };

  const filtered = (data.findings || []).filter(f => {
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
                background: isActive ? (cfg?.color || '#388bfd') : '#161b22',
                color: isActive ? '#fff' : '#8b949e',
                border: `1px solid ${isActive ? (cfg?.color || '#388bfd') : '#30363d'}`,
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
            borderRadius: 6, border: '1px solid #30363d',
            background: '#161b22', color: '#e6edf3',
            fontSize: 12, outline: 'none', width: 200,
          }}
        />
      </div>

      {/* Result count */}
      <div style={{ fontSize: 12, color: '#8b949e' }}>
        Hiển thị {filtered.length} / {(data.findings || []).length} lỗ hổng
      </div>

      {/* Findings list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '48px 0',
            color: '#8b949e', fontSize: 14,
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
                background: '#161b22',
                border: `1px solid ${isOpen ? '#388bfd' : '#30363d'}`,
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
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e6edf3' }}>
                    {f.query_name}
                  </div>
                  <div style={{ fontSize: 12, color: '#8b949e', marginTop: 3 }}>
                    {f.file}
                    {f.line != null ? ` · dòng ${f.line}` : ''}
                    {f.resource_type ? ` · ${f.resource_type}` : ''}
                    {f.resource_name ? `/${f.resource_name}` : ''}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  <span style={{
                    fontSize: 11, background: '#21262d',
                    borderRadius: 4, padding: '2px 8px', color: '#8b949e',
                  }}>
                    {f.cloud_provider}
                  </span>
                  <span style={{ color: '#8b949e', fontSize: 12 }}>
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
