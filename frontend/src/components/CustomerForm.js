import React, { useState } from 'react';

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid #30363d',
  background: '#0d1117',
  color: '#e6edf3',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block',
  fontSize: 11,
  color: '#8b949e',
  marginBottom: 4,
  fontWeight: 600,
};

export default function CustomerForm({ onSubmit, onRemove, loading }) {
  const [customerId, setCustomerId] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [region, setRegion] = useState('ap-southeast-1');
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
      background: '#161b22',
      border: '1px solid #30363d',
      borderRadius: 12,
      padding: '24px',
      marginBottom: 20,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#e6edf3', marginBottom: 16 }}>
        Ket noi AWS Customer
      </div>

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { id: 'setup', label: 'Them khach + key' },
          { id: 'scan', label: 'Quet ngay' },
          { id: 'load', label: 'Tai ket qua' },
          { id: 'remove', label: 'Xoa khach' },
        ].map(m => (
          <button
            key={m.id}
            onClick={() => { setMode(m.id); setMsg(null); }}
            style={{
              padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
              background: mode === m.id ? '#1f6feb' : '#21262d',
              color: mode === m.id ? '#fff' : '#8b949e',
              border: `1px solid ${mode === m.id ? '#1f6feb' : '#30363d'}`,
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
                    onChange={e => setRegion(e.target.value)}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Chu ky quet</label>
                  <select
                    style={inputStyle}
                    value={schedule}
                    onChange={e => setSchedule(e.target.value)}
                  >
                    <option value="daily">Hang ngay</option>
                    <option value="weekly">Hang tuan</option>
                  </select>
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
              background: loading ? '#1a3a20' : (mode === 'remove' ? '#da3633' : '#238636'),
              color: '#fff', border: 'none', alignSelf: 'flex-start',
            }}
          >
            {loading ? 'Dang xu ly...' : (mode === 'setup' ? 'Luu key' : mode === 'scan' ? 'Bat dau quet' : mode === 'load' ? 'Tai ket qua moi nhat' : 'Xoa khach')}
          </button>

          {msg && (
            <div style={{
              padding: '8px 12px', borderRadius: 6, fontSize: 12,
              background: msg.type === 'error' ? '#3d1515' : '#1c2a1c',
              color: msg.type === 'error' ? '#ffa198' : '#3fb950',
              border: `1px solid ${msg.type === 'error' ? '#f85149' : '#3fb95066'}`,
            }}>
              {msg.text}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
