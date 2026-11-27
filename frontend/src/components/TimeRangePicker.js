import React, { useState } from 'react';
import {
  PRESET_GROUPS, DEFAULT_RANGE, isRangeActive, formatRangeLabel, parseCustomEnd,
} from '../utils/timeRange';

/* value: { preset, from, to }   onChange(range) */
export default function TimeRangePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const active = isRangeActive(value);

  const toggle = () => {
    if (!open) {
      // mở bảng: điền sẵn khoảng tùy chỉnh đang áp dụng (nếu có)
      setFrom(value.preset === 'custom' ? value.from : '');
      setTo(value.preset === 'custom' ? value.to : '');
    }
    setOpen(o => !o);
  };

  const pick = key => {
    onChange({ preset: key, from: '', to: '' });
    setOpen(false);
  };

  const fromD = from ? new Date(from) : null;
  const toD = parseCustomEnd(to);
  const missing = !from && !to;
  const reversed = !!(fromD && toD && fromD.getTime() > toD.getTime());
  const canApply = !missing && !reversed;

  const apply = () => {
    if (!canApply) return;
    onChange({ preset: 'custom', from, to });
    setOpen(false);
  };

  return (
    <div style={s.wrap}>
      <button
        type="button"
        style={{ ...s.btn, ...(active ? s.btnActive : null) }}
        onClick={toggle}
        title="Chọn khoảng thời gian"
      >
        🕒 {formatRangeLabel(value)} ▾
      </button>

      {open && (
        <>
          <div style={s.backdrop} onClick={() => setOpen(false)} />
          <div style={s.menu} role="dialog" aria-label="Chọn khoảng thời gian">
            <button
              type="button"
              style={{ ...s.item, ...(!active ? s.itemOn : null) }}
              onClick={() => { onChange(DEFAULT_RANGE); setOpen(false); }}
            >
              <span>Tất cả thời gian</span>{!active && <span>✓</span>}
            </button>

            {PRESET_GROUPS.map(g => (
              <div key={g.title}>
                <div style={s.group}>{g.title}</div>
                {g.items.map(p => (
                  <button
                    key={p.key}
                    type="button"
                    style={{ ...s.item, ...(value.preset === p.key ? s.itemOn : null) }}
                    onClick={() => pick(p.key)}
                  >
                    <span>{p.label}</span>{value.preset === p.key && <span>✓</span>}
                  </button>
                ))}
              </div>
            ))}

            <div style={s.group}>Khoảng cụ thể</div>
            <div style={s.custom}>
              <label style={s.label}>
                Từ
                <input
                  type="datetime-local"
                  step="1"
                  style={s.input}
                  value={from}
                  onChange={e => setFrom(e.target.value)}
                />
              </label>
              <label style={s.label}>
                Đến
                <input
                  type="datetime-local"
                  step="1"
                  style={s.input}
                  value={to}
                  onChange={e => setTo(e.target.value)}
                />
              </label>
              {reversed && <div style={s.err}>Mốc bắt đầu đang sau mốc kết thúc.</div>}
              <button
                type="button"
                style={{ ...s.apply, opacity: canApply ? 1 : 0.5, cursor: canApply ? 'pointer' : 'not-allowed' }}
                disabled={!canApply}
                onClick={apply}
              >
                Áp dụng
              </button>
              <div style={s.tip}>Bỏ trống một ô để không giới hạn phía đó.</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const s = {
  wrap: { position: 'relative' },
  btn: { background: 'var(--surface)', color: 'var(--text)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 6, padding: '9px 12px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
  btnActive: { borderColor: 'var(--accent)', color: 'var(--accent-text)' },
  backdrop: { position: 'fixed', inset: 0, zIndex: 15 },
  menu: { position: 'absolute', left: 0, top: 'calc(100% + 4px)', zIndex: 16, width: 280, maxHeight: '70vh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 6, boxShadow: '0 8px 24px rgba(0,0,0,.35)' },
  group: { fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-muted)', padding: '10px 10px 4px' },
  item: { display: 'flex', justifyContent: 'space-between', width: '100%', background: 'none', border: 0, color: 'var(--text)', padding: '7px 10px', fontSize: 13, textAlign: 'left', cursor: 'pointer', borderRadius: 4 },
  itemOn: { background: 'var(--surface-2)', color: 'var(--accent-text)', fontWeight: 600 },
  custom: { padding: '2px 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' },
  input: { background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 8px', fontSize: 13, colorScheme: 'dark light' },
  err: { fontSize: 12, color: 'var(--danger-text)' },
  apply: { background: 'var(--success-strong)', color: '#fff', border: 0, borderRadius: 6, padding: '8px 12px', fontSize: 13 },
  tip: { fontSize: 11, color: 'var(--text-muted)' },
};