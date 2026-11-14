import React from 'react';
import { SEVERITY_CONFIG } from '../constants';

const card = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '20px 24px',
};

const label = {
  fontSize: 11,
  color: 'var(--text-muted)',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  marginBottom: 14,
};

function fmt(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('vi-VN');
}

function SevChips({ severities }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {Object.entries(severities || {}).map(([sev, count]) => {
        const cfg = SEVERITY_CONFIG[sev] || SEVERITY_CONFIG.INFO;
        return (
          <span key={sev} style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
            color: cfg.text, background: cfg.bg, border: `1px solid ${cfg.border}`,
          }}>
            {cfg.label} {count}
          </span>
        );
      })}
    </div>
  );
}

function Stat({ title, value, color }) {
  return (
    <div style={{
      background: 'var(--bg)', border: '1px solid var(--surface-2)',
      borderRadius: 8, padding: '12px 16px',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color || 'var(--text)', lineHeight: 1.2 }}>{value}</div>
    </div>
  );
}

export default function AIAnalysisPage({ customerId, data, result, loading, error, onRun }) {
  const findingsById = {};
  (data?.findings || []).forEach((f, i) => {
    findingsById[f.id || `finding-${i + 1}`] = f;
  });

  const scannedAt = data?.summary?.scan_end || data?.scanned_at;
  const severities = result?.summary?.severities || {};

  const Header = ({ canRerun }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 260 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: 'var(--text)' }}>Kết quả phân tích AI</h1>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Gemini đọc <code>merged-results.json</code> + <code>iac.zip</code> trên S3, tóm tắt lỗ hổng theo nhóm
          và gộp remediation của KICS thành khuyến nghị ưu tiên. Số liệu giữ nguyên từ scanner.
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>
          Customer: <b style={{ color: 'var(--text-muted)' }}>{customerId || 'N/A'}</b>
          {scannedAt ? <> · Lần quét: <b style={{ color: 'var(--text-muted)' }}>{fmt(scannedAt)}</b></> : null}
        </p>
      </div>
      <button
        onClick={() => onRun(canRerun)}
        disabled={loading || !customerId}
        style={{
          padding: '9px 18px', borderRadius: 6, fontSize: 12, fontWeight: 700,
          cursor: (loading || !customerId) ? 'not-allowed' : 'pointer',
          background: (loading || !customerId) ? 'var(--surface-2)' : 'var(--purple)',
          color: (loading || !customerId) ? 'var(--text-muted)' : '#fff',
          border: '1px solid var(--purple)',
        }}
      >
        {loading ? 'Đang phân tích...' : canRerun ? 'Phân tích lại' : 'Phân tích ngay'}
      </button>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Header canRerun={!!result} />

      {error && (
        <div style={{
          padding: '12px 16px', borderRadius: 8, fontSize: 12,
          background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', color: 'var(--danger-text)',
        }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ ...card, textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600, marginBottom: 8 }}>
            Đang gửi kết quả quét cho Gemini...
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Dữ liệu Terraform đang được che bí mật trước khi gửi. Quá trình thường mất 10–40 giây.
          </div>
        </div>
      )}

      {!loading && !result && !error && (
        <div style={{ ...card, textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600, marginBottom: 8 }}>
            Chưa có kết quả phân tích
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Hệ thống tự gọi Gemini ngay khi pipeline quét xong. Kết quả được giữ lại khi tải lại trang;
            bấm “Quét ngay” ở Dashboard để phân tích lần mới.
          </div>
        </div>
      )}

      {!loading && result && (
        <>
          {/* Tổng quan số liệu */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12,
          }}>
            <Stat title="Tổng finding" value={result.summary.total_findings} color="var(--danger)" />
            <Stat title="Critical" value={severities.CRITICAL || 0} color={SEVERITY_CONFIG.CRITICAL.text} />
            <Stat title="High" value={severities.HIGH || 0} color={SEVERITY_CONFIG.HIGH.text} />
            <Stat title="Nhóm lỗ hổng" value={result.summary.groups} color="var(--accent-text)" />
            <Stat title="Bí mật đã che" value={result.summary.masked_secrets} color="var(--success)" />
            <Stat title="File Terraform" value={(result.summary.iac_files || []).length} color="var(--purple-text)" />
          </div>

          {/* 1. Tổng quan theo nhóm */}
          <div style={card}>
            <div style={label}>1 · Tổng quan lỗ hổng theo nhóm</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {(result.overview || []).map((g, i) => (
                <div key={i} style={{
                  background: 'var(--bg)', border: '1px solid var(--surface-2)',
                  borderRadius: 8, padding: '14px 16px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{g.group}</span>
                    <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent-text)' }}>{g.count}</span>
                  </div>
                  <SevChips severities={g.severities} />
                  <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                    {g.summary}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* 2. Khuyến nghị */}
          <div style={card}>
            <div style={label}>2 · Khuyến nghị theo thứ tự ưu tiên</div>

            {(result.recommendations || []).length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Không có khuyến nghị nào truy vết được về finding trong dữ liệu quét.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(result.recommendations || []).map((r) => {
                const cfg = SEVERITY_CONFIG[r.severity] || SEVERITY_CONFIG.INFO;
                const matched = (r.finding_ids || []).map(id => findingsById[id]).filter(Boolean);
                return (
                  <div key={r.priority} style={{
                    background: 'var(--bg)', border: '1px solid var(--surface-2)',
                    borderLeft: `4px solid ${cfg.color}`,
                    borderRadius: 8, padding: '14px 18px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{
                        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                        background: 'var(--surface-2)', color: 'var(--text-secondary)',
                        fontSize: 11, fontWeight: 800,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}>{r.priority}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', flex: 1, minWidth: 180 }}>
                        {r.title}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                        color: cfg.text, background: cfg.bg, border: `1px solid ${cfg.border}`,
                      }}>{cfg.label}</span>
                    </div>

                    <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                      {r.action}
                    </p>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: matched.length ? 12 : 0 }}>
                      {(r.query_names || []).map((q, qi) => (
                        <span key={qi} style={{
                          fontSize: 10, padding: '2px 7px', borderRadius: 4,
                          background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)',
                        }}>{q}</span>
                      ))}
                      {(r.references || []).map((ref, ri) => (
                        <a
                          key={`ref-${ri}`}
                          href={ref.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: 10, padding: '2px 7px', borderRadius: 4,
                            background: 'var(--accent-bg)', color: 'var(--accent-text)',
                            border: '1px solid var(--accent-border)', textDecoration: 'none',
                          }}
                          title={ref.url}
                        >
                          KICS docs{ref.risk_score ? ` · risk ${ref.risk_score}` : ''} ↗
                        </a>
                      ))}
                    </div>

                    {matched.length > 0 && (
                      <div style={{
                        borderTop: '1px solid var(--surface-2)', paddingTop: 10,
                        display: 'flex', flexDirection: 'column', gap: 6,
                      }}>
                        <div style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          Finding gốc ({matched.length})
                        </div>
                        {matched.slice(0, 5).map((f, fi) => {
                          const fcfg = SEVERITY_CONFIG[(f.severity || '').toUpperCase()] || SEVERITY_CONFIG.INFO;
                          return (
                            <div key={fi} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: fcfg.color, flexShrink: 0 }} />
                              <span style={{ color: 'var(--text-secondary)' }}>{f.query_name}</span>
                              <span>·</span>
                              <span>{f.file}{f.line != null ? `:${f.line}` : ''}</span>
                              {f.resource_name ? <span>· {f.resource_type}/{f.resource_name}</span> : null}
                            </div>
                          );
                        })}
                        {matched.length > 5 && (
                          <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>+{matched.length - 5} finding khác</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ ...card, padding: '14px 18px', fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.6 }}>
            <b style={{ color: 'var(--text-muted)' }}>Ghi chú phương pháp:</b> {result.note} Mọi khuyến nghị đều gắn với
            finding gốc của KICS/Trivy và bị loại nếu không truy vết được. AI không phát hiện thêm lỗ hổng.
          </div>
        </>
      )}
    </div>
  );
}
