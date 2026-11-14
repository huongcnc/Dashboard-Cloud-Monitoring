import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar         from './components/Sidebar';
import Topbar          from './components/Topbar';
import CustomerForm    from './components/CustomerForm';
import DashboardPage   from './pages/DashboardPage';
import ScanPage        from './pages/ScanPage';
import LogsPage        from './pages/LogsPage';
import AlertsPage      from './pages/AlertsPage';
import AIAnalysisPage  from './pages/AIAnalysisPage';
import PlaceholderPage from './pages/PlaceholderPage';
import { SAMPLE_DATA } from './constants';
import {
  setupCustomer,
  removeCustomer,
  triggerScan,
  getScanStatus,
  fetchLatestResults,
  fetchHistoryDetail,
  analyzeWithAI,
} from './utils/api';

const DEFAULT_CUSTOMER_ID = process.env.REACT_APP_DEFAULT_CUSTOMER_ID || 'cust-zept';

/* Kết quả AI được giữ qua các lần tải lại trang, chỉ dùng nếu cùng customer */
function readAiCache() {
  try {
    const cache = JSON.parse(localStorage.getItem('aiCache') || 'null');
    if (!cache || !cache.result) return null;
    const currentCustomer = localStorage.getItem('lastCustomerId') || DEFAULT_CUSTOMER_ID;
    return cache.customerId === currentCustomer ? cache : null;
  } catch (e) {
    return null;
  }
}

function readPage() {
  try {
    return localStorage.getItem('page') || 'dashboard';
  } catch (e) {
    return 'dashboard';
  }
}

export default function App() {
  const [page,       setPage]       = useState(readPage);
  const [scanResult, setScanResult] = useState(() => {
    try { return JSON.parse(localStorage.getItem('scanResult') || 'null'); } catch(e) { return null; }
  });
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [clock,      setClock]      = useState(new Date());
  const [customerId, setCustomerId] = useState(
    () => localStorage.getItem('lastCustomerId') || DEFAULT_CUSTOMER_ID
  );
  const [scanInfo,   setScanInfo]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('scanInfo') || 'null'); } catch(e) { return null; }
  });
  const [aiResult,   setAiResult]   = useState(() => readAiCache()?.result || null);
  const [aiLoading,  setAiLoading]  = useState(false);
  const [aiError,    setAiError]    = useState('');
  const [aiScanStamp, setAiScanStamp] = useState(() => readAiCache()?.scanStamp || null);
  const [aiCustomerId, setAiCustomerId] = useState(() => readAiCache()?.customerId || null);
  const [theme,      setTheme]      = useState(() => {
    try { return localStorage.getItem('theme') || 'dark'; } catch (e) { return 'dark'; }
  });

  const data = scanResult || SAMPLE_DATA;

  /* moc thoi gian cua ket qua dang hien thi, de biet S3 da co ban quet moi chua */
  const scanStampRef = useRef(null);
  useEffect(() => {
    const current = scanResult?.scanned_at || scanResult?.summary?.scan_end || null;
    scanStampRef.current = current;
  }, [scanResult]);

  /* goi Gemini de phan tich ket qua quet (Tang 2) */
  const runAIAnalysis = useCallback(async (opts = {}) => {
    const targetCustomer = opts.targetCustomer || customerId;
    const force = !!opts.force;
    const stamp = opts.scanStamp !== undefined
      ? opts.scanStamp
      : (scanResult?.scanned_at || scanResult?.summary?.scan_end || null);
    if (!targetCustomer) return null;
    setAiLoading(true);
    setAiError('');
    try {
      const res = await analyzeWithAI(targetCustomer, force);
      setAiResult(res);
      setAiScanStamp(stamp);
      setAiCustomerId(targetCustomer);
      return res;
    } catch (e) {
      setAiError(e.message);
      return null;
    } finally {
      setAiLoading(false);
    }
  }, [customerId, scanResult]);

  /* luu ket qua AI de tai lai trang khong mat */
  useEffect(() => {
    try {
      if (aiResult) {
        localStorage.setItem('aiCache', JSON.stringify({
          customerId: aiCustomerId || customerId,
          scanStamp: aiScanStamp,
          result: aiResult,
        }));
      } else {
        localStorage.removeItem('aiCache');
      }
    } catch (e) { /* ignore */ }
  }, [aiResult, aiScanStamp, aiCustomerId, customerId]);

  /* doi sang lan quet khac thi bo ket qua AI cu */
  useEffect(() => {
    if (!aiResult) return;
    const stamp = scanResult?.scanned_at || scanResult?.summary?.scan_end || null;
    if (stamp && aiScanStamp && stamp !== aiScanStamp) {
      setAiResult(null);
      setAiScanStamp(null);
      setAiCustomerId(null);
    }
  }, [scanResult, aiResult, aiScanStamp]);

  /* nho trang dang mo khi tai lai */
  useEffect(() => {
    try { localStorage.setItem('page', page); } catch (e) { /* ignore */ }
  }, [page]);

  /* clock */
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* sang/toi */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch (e) { /* ignore */ }
  }, [theme]);

  /* auto load latest results when dashboard opens */
  useEffect(() => {
    if (scanResult || !customerId) return;
    fetchLatestResults(customerId)
      .then(results => {
        if (results) setScanResult(results);
      })
      .catch(() => {});
  }, [scanResult, customerId]);

  /* poll scan status khi dang chay */
  useEffect(() => {
    if (!scanInfo || scanInfo.status === 'completed') return;
    const t = setInterval(async () => {
      try {
        const st = await getScanStatus(scanInfo.run_id);
        // /api/scan/status khong tra customer_id -> giu lai thong tin cu, chi cap nhat trang thai
        setScanInfo(prev => ({ ...prev, ...st, customer_id: prev?.customer_id || scanInfo.customer_id }));
        if (st.status === 'completed') {
          if (st.conclusion && st.conclusion !== 'success') {
            setError(`Pipeline kết thúc với trạng thái "${st.conclusion}" - không chạy phân tích AI.`);
            return;
          }
          // Doi S3 cap nhat ban quet moi (pipeline bao completed truoc khi upload xong)
          const baseline = scanStampRef.current;
          let results = null;
          for (let attempt = 0; attempt < 30 && !results; attempt++) {
            let latest = null;
            try {
              latest = await fetchLatestResults(scanInfo.customer_id);
            } catch (e) { /* ignore */ }
            if (latest) {
              const stamp = latest.scanned_at || latest.summary?.scan_end || null;
              if (!baseline || (stamp && stamp !== baseline)) results = latest;
            }
            if (!results) await new Promise(r => setTimeout(r, 3000));
          }

          if (!results) {
            setError('Pipeline đã xong nhưng chưa thấy kết quả mới trên S3 sau 90 giây. Thử tải lại kết quả sau.');
            return;
          }

          const newStamp = results.scanned_at || results.summary?.scan_end || null;
          setScanResult(results);
          setAiResult(null);
          setAiScanStamp(null);
          setAiCustomerId(null);
          setPage('ai');
          await runAIAnalysis({ targetCustomer: scanInfo.customer_id, scanStamp: newStamp });
        }
      } catch (e) { /* ignore poll errors */ }
    }, 10000);
    return () => clearInterval(t);
  }, [scanInfo, runAIAnalysis]);

  useEffect(() => { localStorage.setItem('scanResult', JSON.stringify(scanResult)); }, [scanResult]);
  useEffect(() => { localStorage.setItem('scanInfo', JSON.stringify(scanInfo)); }, [scanInfo]);

  /* xu ly form khach hang */
  const handleCustomerSubmit = useCallback(async (payload) => {
    setLoading(true);
    setError(null);
    try {
      if (payload.mode === 'load') {
        localStorage.setItem('lastCustomerId', payload.customer_id);
        setCustomerId(payload.customer_id);
        setAiResult(null);
        setAiScanStamp(null);
        setAiCustomerId(null);
        setAiError('');
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
        setCustomerId(payload.customer_id);
        setAiResult(null);
        setAiScanStamp(null);
        setAiCustomerId(null);
        setAiError('');
        const res = await triggerScan(payload.customer_id, payload.region);
        setScanInfo({
          run_id: res.run_id,
          customer_id: payload.customer_id,
          status: 'queued',
        });
        return { type: 'success', text: `Da bat dau quet (run #${res.run_id}). Dang cho pipeline...` };
      }
      const res = await setupCustomer(payload);
      if (res.customer_id) {
        localStorage.setItem('lastCustomerId', res.customer_id);
        setCustomerId(res.customer_id);
        setAiResult(null);
        setAiScanStamp(null);
        setAiCustomerId(null);
        setAiError('');
      }
      return { type: 'success', text: res.message || 'Da luu key thanh cong.' };
    } catch (err) {
      setError(err.message);
      return { type: 'error', text: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  /* xem ket qua cua mot lan quet cu (history tren S3) */
  const handleSelectHistory = useCallback(async (timestamp) => {
    if (!customerId) return;
    setAiResult(null);
    setAiScanStamp(null);
    setAiCustomerId(null);
    setAiError('');
    try {
      const results = timestamp
        ? await fetchHistoryDetail(customerId, timestamp)
        : await fetchLatestResults(customerId);
      if (results) setScanResult(results);
    } catch (e) { /* ignore */ }
  }, [customerId]);

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
            <DashboardPage
              data={data}
              customerId={customerId}
              onSelectHistory={handleSelectHistory}
            />
          </>
        );
      case 'ai':
        return (
          <AIAnalysisPage
            customerId={customerId}
            data={scanResult}
            result={aiResult}
            loading={aiLoading}
            error={aiError}
            onRun={(force) => runAIAnalysis({ force })}
          />
        );
      case 'scan':      return <ScanPage data={data} />;
      case 'logs':      return <LogsPage />;
      case 'alerts':    return <AlertsPage />;
      default:          return <PlaceholderPage page={page} />;
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>

      <Sidebar activePage={page} onNavigate={setPage} />

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Topbar
          clock={clock}
          scanInfo={scanInfo}
          page={page}
          theme={theme}
          onToggleTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
        />

        <div style={{ flex: 1, padding: '24px 28px', overflowY: 'auto' }}>

          {error && (
            <div style={{
              background: 'var(--danger-bg)', border: '1px solid var(--danger)',
              borderRadius: 8, padding: '10px 16px',
              marginBottom: 20, fontSize: 13, color: 'var(--danger-text)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--danger-text)', cursor: 'pointer', fontSize: 16 }}
              >x</button>
            </div>
          )}

          {/* Scan progress badge */}
          {scanInfo && scanInfo.status !== 'completed' && (
            <div style={{
              background: 'var(--info-bg)', border: '1px solid var(--accent-strong)',
              borderRadius: 8, padding: '10px 16px',
              marginBottom: 20, fontSize: 13, color: 'var(--accent-text)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>Pipeline dang chay (run #{scanInfo.run_id}) - trang thai: {scanInfo.status}...</span>
            </div>
          )}

          {!scanResult && ['dashboard', 'scan'].includes(page) && (
            <div style={{
              background: 'var(--success-bg)', border: '1px solid var(--success-tint-border)',
              borderRadius: 8, padding: '8px 16px',
              marginBottom: 20, fontSize: 12, color: 'var(--success)',
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
