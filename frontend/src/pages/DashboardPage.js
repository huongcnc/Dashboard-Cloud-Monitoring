import React from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from 'recharts';
import { SEVERITY_CONFIG, CLOUD_COLORS } from '../constants';
import SeverityBadge from '../components/SeverityBadge';
import ScanHistory from '../components/ScanHistory';

/* ── helpers ── */
function Card({ children, style }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '20px 24px',
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, color: 'var(--text-muted)', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14,
    }}>
      {children}
    </div>
  );
}

function InfoRow({ label, value, mono, success }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{
        color: success ? 'var(--success)' : 'var(--text)',
        fontFamily: mono ? 'monospace' : 'inherit',
        fontSize: mono ? 11 : 13,
        fontWeight: 500,
      }}>
        {value}
      </span>
    </div>
  );
}

const CATEGORY_COLORS = ['var(--accent)', 'var(--success)', '#ffa657', '#f78166', 'var(--purple-text)'];

const CLOUD_ICONS = { AWS: '☁', Azure: '△', GCP: '◐' };

/* ── custom pie label ── */
function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.6;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

/* ── main component ── */
export default function DashboardPage({ data, customerId, onSelectHistory }) {
  const s = data.summary;
  const total = s.total || 1;
  const scannedAt = s.scan_end || data.scanned_at;
  const scanLabel = scannedAt && !Number.isNaN(new Date(scannedAt).getTime())
    ? `Quét lúc ${new Date(scannedAt).toLocaleString('vi-VN')}`
    : 'Số liệu lấy trực tiếp từ kết quả quét';

  const pieData = [
    { name: 'Critical', value: s.critical, color: SEVERITY_CONFIG.CRITICAL.color },
    { name: 'High',     value: s.high,     color: SEVERITY_CONFIG.HIGH.color     },
    { name: 'Medium',   value: s.medium,   color: SEVERITY_CONFIG.MEDIUM.color   },
    { name: 'Low',      value: s.low,      color: SEVERITY_CONFIG.LOW.color      },
    { name: 'Info',     value: s.info,     color: SEVERITY_CONFIG.INFO.color     },
  ].filter(d => d.value > 0);

  const cloudData = (data.cloud_breakdown || []).map((c, i) => ({
    ...c, color: CLOUD_COLORS[i % CLOUD_COLORS.length],
  }));

  const maxCat = Math.max(...(data.top_categories || []).map(c => c.count), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      <ScanHistory customerId={customerId} onSelect={onSelectHistory} />

      {/* ── Row 1 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 16 }}>

        {/* Total */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <SectionLabel>Tổng số lỗ hổng</SectionLabel>
            <span style={{ fontSize: 22 }}>🛡</span>
          </div>
          <div style={{ fontSize: 56, fontWeight: 800, color: 'var(--danger)', lineHeight: 1 }}>{s.total}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>lỗ hổng được phát hiện</div>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            {scanLabel}
          </div>
        </Card>

        {/* Pie */}
        <Card>
          <SectionLabel>Phân loại lỗ hổng</SectionLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ width: 190, height: 170, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    cx="50%" cy="50%"
                    innerRadius={48} outerRadius={78}
                    paddingAngle={2}
                    labelLine={false}
                    label={<PieLabel />}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                    itemStyle={{ color: 'var(--text)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              {[
                { key: 'CRITICAL', val: s.critical },
                { key: 'HIGH',     val: s.high     },
                { key: 'MEDIUM',   val: s.medium   },
                { key: 'LOW',      val: s.low      },
                { key: 'INFO',     val: s.info     },
              ].map(({ key, val }) => {
                const cfg = SEVERITY_CONFIG[key];
                const pct = ((val / total) * 100).toFixed(1);
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{cfg.label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: cfg.text }}>{val}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({pct}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        {/* Scan info */}
        <Card>
          <SectionLabel>Thông tin quét</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <InfoRow label="Files quét"     value={s.files_scanned}              />
            <InfoRow label="Dòng quét"      value={(s.lines_scanned || 0).toLocaleString()} />
            <InfoRow label="Phiên bản KICS" value={s.kics_version || 'N/A'}      mono />
            <InfoRow label="Trạng thái"     value="✓ Hoàn thành"                 success />
          </div>
        </Card>
      </div>

      {/* ── Row 2: Cloud providers ── */}
      <Card>
        <SectionLabel>Cloud Provider</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {cloudData.length > 0 ? cloudData.map((c, i) => (
            <div key={i} style={{
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '14px 18px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: c.color + '22',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, color: c.color,
                }}>
                  {CLOUD_ICONS[c.provider] || '◈'}
                </div>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{c.provider}</span>
              </div>
              <div style={{ fontSize: 30, fontWeight: 800, color: c.color }}>{c.count}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>lỗ hổng</div>
            </div>
          )) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Không có dữ liệu.</div>
          )}
        </div>
      </Card>

      {/* ── Row 3 ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 16 }}>

        {/* Categories */}
        <Card>
          <SectionLabel>Danh mục lỗ hổng</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(data.top_categories || []).map((cat, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{cat.name}</span>
                  <span style={{ color: CATEGORY_COLORS[i % CATEGORY_COLORS.length], fontWeight: 700 }}>{cat.count}</span>
                </div>
                <div style={{ height: 5, background: 'var(--surface-2)', borderRadius: 3 }}>
                  <div style={{
                    width: `${(cat.count / maxCat) * 100}%`,
                    height: '100%',
                    background: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                    borderRadius: 3,
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Recent findings */}
        <Card>
          <SectionLabel>Lỗ hổng gần đây</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(data.findings || []).slice(0, 5).map((f, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '10px 12px',
                background: 'var(--bg)', borderRadius: 8,
                border: '1px solid var(--surface-2)',
              }}>
                <SeverityBadge severity={f.severity} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 500, color: 'var(--text)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {f.query_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {f.file} · dòng {f.line}
                  </div>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{f.cloud_provider}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

    </div>
  );
}
