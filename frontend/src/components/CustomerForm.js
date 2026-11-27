import React, { useState } from 'react';

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block',
  fontSize: 11,
  color: 'var(--text-muted)',
  marginBottom: 4,
  fontWeight: 600,
};

export default function CustomerForm({ onSubmit, onRemove, loading }) {
  const [customerId, setCustomerId] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [region, setRegion] = useState('auto'); // auto = pipeline tu do region
  const [schedule, setSchedule] = useState('daily');
  const [mode, setMode] = useState(null); // 'setup' | 'scan' | 'remove'
  const [msg, setMsg] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (mode === 'setup') {
      if (!customerId || !accessKey || !secretKey) {
        setMsg({ type: 'error', text: 'Vui long nhap day du thong tin.' });
        return;
      }
      const res = await onSubmit({
        customer_id: customerId,
        aws_access_key_id: accessKey,
        aws_secret_access_key: secretKey,
        aws_region: region,
        schedule,
      });
      setMsg(res);
    } else if (mode === 'scan') {
      if (!customerId) {
        setMsg({ type: 'error', text: 'Vui long nhap Customer ID.' });
        return;
      }
      const res = await onSubmit({ mode: 'scan', customer_id: customerId, region });
      setMsg(res);
    } else if (mode === 'load') {
      if (!customerId) {
        setMsg({ type: 'error', text: 'Vui long nhap Customer ID.' });
        return;
      }
      const res = await onSubmit({ mode: 'load', customer_id: customerId });
      setMsg(res);
    } else if (mode === 'remove') {
      if (!customerId) {
        setMsg({ type: 'error', text: 'Vui long nhap Customer ID.' });
        return;
      }
      const res = await onRemove(customerId);
      setMsg(res);
    }
  };

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '24px',
      marginBottom: 20,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>
        Ket noi AWS Customer
      </div>

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { id: 'setup', label: 'Thêm khách hàng + key' },
          { id: 'scan', label: 'Quét ngay' }
        ].map(m => (
          <button
            key={m.id}
            onClick={() => { setMode(m.id); setMsg(null); }}
            style={{
              padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
              background: mode === m.id ? 'var(--accent-strong)' : 'var(--surface-2)',
              color: mode === m.id ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${mode === m.id ? 'var(--accent-strong)' : 'var(--border)'}`,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode && (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Customer ID</label>
            <input
              style={inputStyle}
              placeholder="vd: acme-corp"
              value={customerId}
              onChange={e => setCustomerId(e.target.value)}
            />
          </div>

          {mode === 'setup' && (
            <>
              <div>
                <label style={labelStyle}>AWS Access Key ID</label>
                <input
                  style={inputStyle}
                  placeholder="AKIA..."
                  value={accessKey}
                  onChange={e => setAccessKey(e.target.value)}
                />
              </div>
              <div>
                <label style={labelStyle}>AWS Secret Access Key</label>
                <input
                  style={inputStyle}
                  type="password"
                  placeholder="********"
                  value={secretKey}
                  onChange={e => setSecretKey(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Region</label>
                  <input
                    style={inputStyle}
                    value={region}
                    placeholder="auto hoac us-east-1,ap-southeast-1"
                    onChange={e => setRegion(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '9px 20px', borderRadius: 6, fontSize: 13, fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              background: loading ? 'var(--success-bg)' : (mode === 'remove' ? 'var(--danger-strong)' : 'var(--success-strong)'),
              color: '#fff', border: 'none', alignSelf: 'flex-start',
            }}
          >
            {loading ? 'Dang xu ly...' : (mode === 'setup' ? 'Lưu key' : mode === 'scan' ? 'Bắt đầu quét' : mode === 'load' ? 'Tai ket qua moi nhat' : 'Xoa khach')}
          </button>

          {msg && (
            <div style={{
              padding: '8px 12px', borderRadius: 6, fontSize: 12,
              background: msg.type === 'error' ? 'var(--danger-bg)' : 'var(--success-bg)',
              color: msg.type === 'error' ? 'var(--danger-text)' : 'var(--success)',
              border: `1px solid ${msg.type === 'error' ? 'var(--danger)' : 'var(--success-tint-border)'}`,
            }}>
              {msg.text}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
