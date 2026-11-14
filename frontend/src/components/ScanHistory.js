import React, { useEffect, useState } from 'react';
import { fetchHistory } from '../utils/api';

function fmtTs(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('vi-VN');
}

export default function ScanHistory({ customerId, onSelect }) {
  const [items, setItems] = useState([]);
  const [value, setValue] = useState('');

  useEffect(() => {
    let alive = true;
    setValue('');
    if (!customerId) {
      setItems([]);
      return () => { alive = false; };
    }
    fetchHistory(customerId)
      .then(d => { if (alive) setItems(d.history || []); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [customerId]);

  if (!items.length) return null;

  const handleChange = (e) => {
    setValue(e.target.value);
    if (onSelect) onSelect(e.target.value);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px',
    }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        Lịch sử quét
      </span>
      <select
        value={value}
        onChange={handleChange}
        style={{
          background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '6px 10px', fontSize: 12, outline: 'none',
        }}
      >
        <option value="">Lần quét mới nhất</option>
        {items.map(item => (
          <option key={item.timestamp} value={item.timestamp}>{fmtTs(item.timestamp)}</option>
        ))}
      </select>
      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
        {value ? 'Đang xem kết quả trong quá khứ' : `${items.length} lần quét đã lưu`}
      </span>
    </div>
  );
}
