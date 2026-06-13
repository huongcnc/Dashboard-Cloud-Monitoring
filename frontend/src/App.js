import React, { useState, useEffect, useCallback } from 'react';
import Sidebar         from './components/Sidebar';
import Topbar          from './components/Topbar';
import DashboardPage   from './pages/DashboardPage';
import ScanPage        from './pages/ScanPage';
import LogsPage        from './pages/LogsPage';
import AlertsPage      from './pages/AlertsPage';
import PlaceholderPage from './pages/PlaceholderPage';
import { SAMPLE_DATA } from './constants';
import { scanFile }    from './utils/api';

export default function App() {
  const [page,       setPage]       = useState('dashboard');
  const [scanResult, setScanResult] = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [clock,      setClock]      = useState(new Date());

  const data = scanResult || SAMPLE_DATA;

  /* ── clock ── */
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* ── scan handler ── */
  const handleScan = useCallback(async (file) => {
    setLoading(true);
    setError(null);
    try {
      const result = await scanFile(file);
      setScanResult(result);
      setPage('dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── router ── */
  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <DashboardPage data={data} />;
      case 'scan':      return <ScanPage      data={data} />;
      case 'logs':      return <LogsPage />;
      case 'alerts':    return <AlertsPage />;
      default:          return <PlaceholderPage page={page} />;
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0d1117' }}>

      <Sidebar activePage={page} onNavigate={setPage} />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar onScan={handleScan} loading={loading} clock={clock} />

        <div style={{ flex: 1, padding: '24px 28px', overflowY: 'auto' }}>

          {/* Scan error banner */}
          {error && (
            <div style={{
              background: '#3d1515', border: '1px solid #f85149',
              borderRadius: 8, padding: '10px 16px',
              marginBottom: 20, fontSize: 13, color: '#ffa198',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>⚠</span>
              <span>{error} — đang hiển thị dữ liệu demo.</span>
              <button
                onClick={() => setError(null)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#ffa198', cursor: 'pointer', fontSize: 16 }}
              >✕</button>
            </div>
          )}

          {/* Demo badge (chỉ hiện ở dashboard/scan) */}
          {!scanResult && ['dashboard', 'scan'].includes(page) && (
            <div style={{
              background: '#1c2a1c', border: '1px solid #3fb95066',
              borderRadius: 8, padding: '8px 16px',
              marginBottom: 20, fontSize: 12, color: '#3fb950',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              📊 Đang hiển thị dữ liệu demo — nhấn <strong style={{ marginLeft: 4 }}>"Quét Terraform"</strong> để tải file thực.
            </div>
          )}

          {renderPage()}
        </div>
      </main>
    </div>
  );
}
