import React from 'react';

const PAGE_LABELS = {
  resources: 'Tài nguyên',
  alerts:    'Cảnh báo',
  reports:   'Báo cáo',
  config:    'Cấu hình',
  users:     'Người dùng',
  settings:  'Cài đặt',
};

const PAGE_ICONS = {
  resources: '◈',
  alerts:    '⚠',
  reports:   '⊟',
  config:    '⚙',
  users:     '◉',
  settings:  '≎',
};

export default function PlaceholderPage({ page }) {
  return (
    <div style={{
      background: '#161b22', border: '1px solid #30363d',
      borderRadius: 12, padding: '64px 24px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 52, marginBottom: 16 }}>
        {PAGE_ICONS[page] || '🚧'}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: '#e6edf3', marginBottom: 8 }}>
        {PAGE_LABELS[page] || page}
      </div>
      <div style={{ fontSize: 14, color: '#8b949e' }}>
        Tính năng đang được phát triển.
      </div>
    </div>
  );
}
