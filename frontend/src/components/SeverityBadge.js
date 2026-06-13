import React from 'react';
import { SEVERITY_CONFIG } from '../constants';

export default function SeverityBadge({ severity }) {
  const cfg = SEVERITY_CONFIG[severity] || {
    color: '#888780', bg: '#1a1a18', label: severity,
  };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 700, letterSpacing: '0.03em',
      background: cfg.bg, color: cfg.color,
      border: `1px solid ${cfg.border || cfg.color + '44'}`,
      flexShrink: 0,
      whiteSpace: 'nowrap',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: cfg.color, flexShrink: 0,
      }} />
      {cfg.label}
    </span>
  );
}
