import React, { useState, useEffect, useCallback } from 'react';
import Sidebar         from './components/Sidebar';
import Topbar          from './components/Topbar';
import CustomerForm    from './components/CustomerForm';
import DashboardPage   from './pages/DashboardPage';
import ScanPage        from './pages/ScanPage';
import LogsPage        from './pages/LogsPage';
import AlertsPage      from './pages/AlertsPage';
import PlaceholderPage from './pages/PlaceholderPage';
import { SAMPLE_DATA } from './constants';
import {
  setupCustomer,
  removeCustomer,
  triggerScan,
  getScanStatus,
  fetchLatestResults,
} from './utils/api';

const DEFAULT_CUSTOMER_ID = process.env.REACT_APP_DEFAULT_CUSTOMER_ID || 'cust-zept';

export default function App() {
  const [page,       setPage]       = useState('dashboard');
  const [scanResult, setScanResult] = useState(() => {
    try { return JSON.parse(localStorage.getItem('scanResult') || 'null'); } catch(e) { return null; }
  });
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [clock,      setClock]      = useState(new Date());
  const [scanInfo,   setScanInfo]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('scanInfo') || 'null'); } catch(e) { return null; }
  });

  const data = scanResult || SAMPLE_DATA;

  /* clock */
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* auto load latest results when dashboard opens */
  useEffect(() => {
    if (scanResult) return;
    const customerId = localStorage.getItem('lastCustomerId') || DEFAULT_CUSTOMER_ID;
    if (!customerId) return;
    fetchLatestResults(customerId)
      .then(results => {
        if (results) {
          setScanResult(results);
          localStorage.setItem('lastCustomerId', customerId);
        }
      })
      .catch(() => {});
  }, [scanResult]);

  /* poll scan status khi dang chay */
  useEffect(() => {
    if (!scanInfo || scanInfo.status === 'completed') return;
    const t = setInterval(async () => {
      try {
        const st = await getScanStatus(scanInfo.run_id);
        setScanInfo(st);
        if (st.status === 'completed') {
          // doc ket qua tu S3
          const results = await fetchLatestResults(scanInfo.customer_id);
          if (results) {
            setScanResult(results);
            setPage('dashboard');
          }
        }
      } catch (e) { /* ignore poll errors */ }
    }, 10000);
    return () => clearInterval(t);
  }, [scanInfo]);

  useEffect(() => { localStorage.setItem('scanResult', JSON.stringify(scanResult)); }, [scanResult]);
  useEffect(() => { localStorage.setItem('scanInfo', JSON.stringify(scanInfo)); }, [scanInfo]);

  /* xu ly form khach hang */
  const handleCustomerSubmit = useCallback(async (payload) => {
    setLoading(true);
    setError(null);
    try {
      if (payload.mode === 'load') {
        localStorage.setItem('lastCustomerId', payload.customer_id);
        const results = await fetchLatestResults(payload.customer_id);
        if (!results) {
          return { type: 'error', text: 'Chua co ket qua scan tren S3 cho customer nay.' };
        }
        setScanResult(results);
        setPage('dashboard');
        return { type: 'success', text: 'Da tai ket qua moi nhat: ' + (results.summary?.total || 0) + ' findings.' };
      }
      if (payload.mode === 'scan') {
        localStorage.setItem('lastCustomerId', payload.customer_id);
        const res = await triggerScan(payload.customer_id, payload.region);
        setScanInfo({
          run_id: res.run_id,
          customer_id: payload.customer_id,
          status: 'queued',
        });
        return { type: 'success', text: `Da bat dau quet (run #${res.run_id}). Dang cho pipeline...` };
      }
      const res = await setupCustomer(payload);
      return { type: 'success', text: res.message || 'Da luu key thanh cong.' };
    } catch (err) {
      setError(err.message);
      return { type: 'error', text: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCustomerRemove = useCallback(async (customerId) => {
    setLoading(true);
    try {
      const res = await removeCustomer(customerId);
      return { type: 'success', text: res.message || 'Da xoa khach.' };
    } catch (err) {
      return { type: 'error', text: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  /* router */
  const renderPage = () => {
    switch (page) {
      case 'dashboard':
        return (
          <>
            <CustomerForm
              onSubmit={handleCustomerSubmit}
              onRemove={handleCustomerRemove}
              loading={loading}
            />
            <DashboardPage data={data} />
          </>
        );
      case 'scan':      return <ScanPage data={data} />;
      case 'logs':      return <LogsPage />;
      case 'alerts':    return <AlertsPage />;
      default:          return <PlaceholderPage page={page} />;
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0d1117' }}>

      <Sidebar activePage={page} onNavigate={setPage} />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar clock={clock} scanInfo={scanInfo} />

        <div style={{ flex: 1, padding: '24px 28px', overflowY: 'auto' }}>

          {error && (
            <div style={{
              background: '#3d1515', border: '1px solid #f85149',
              borderRadius: 8, padding: '10px 16px',
              marginBottom: 20, fontSize: 13, color: '#ffa198',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#ffa198', cursor: 'pointer', fontSize: 16 }}
              >x</button>
            </div>
          )}

          {/* Scan progress badge */}
          {scanInfo && scanInfo.status !== 'completed' && (
            <div style={{
              background: '#0c2d6b', border: '1px solid #1f6feb',
              borderRadius: 8, padding: '10px 16px',
              marginBottom: 20, fontSize: 13, color: '#79c0ff',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>Pipeline dang chay (run #{scanInfo.run_id}) - trang thai: {scanInfo.status}...</span>
            </div>
          )}

          {!scanResult && ['dashboard', 'scan'].includes(page) && (
            <div style={{
              background: '#1c2a1c', border: '1px solid #3fb95066',
              borderRadius: 8, padding: '8px 16px',
              marginBottom: 20, fontSize: 12, color: '#3fb950',
            }}>
              Dang hien thi du lieu demo. Nhap key khach roi bam "Quet ngay" de chay pipeline that.
            </div>
          )}

          {renderPage()}
        </div>
      </main>
    </div>
  );
}
