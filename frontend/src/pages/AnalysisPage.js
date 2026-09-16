import React, { useCallback, useEffect, useState } from 'react';
import { SEVERITY_CONFIG } from '../constants';
import { analyzeResults, getAnalysis } from '../utils/api';

const cardStyle = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 10,
  padding: '16px 18px',
};

const mutedStyle = { color: '#8b949e', fontSize: 12, lineHeight: 1.6 };

function SeverityBadge({ severity }) {
  const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.INFO;
  return (
    <span style={{
      padding: '3px 9px',
      borderRadius: 5,
      fontSize: 11,
      fontWeight: 700,
      color: config.color,
      background: config.bg,
      border: `1px solid ${config.border}`,
      whiteSpace: 'nowrap',
    }}>
      {severity}
    </span>
  );
}

function Chip({ children }) {
  return (
    <span style={{
      padding: '3px 8px',
      borderRadius: 5,
      background: '#21262d',
      border: '1px solid #30363d',
      color: '#8b949e',
      fontSize: 11,
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

function SectionTitle({ children, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <h2 style={{ margin: 0, fontSize: 16, color: '#e6edf3' }}>{children}</h2>
      {count != null && <Chip>{count}</Chip>}
    </div>
  );
}

export default function AnalysisPage({ data }) {
  const customerId = data?.customer_id;
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const analysis = job?.result;
  const isRunning = job?.status === 'queued' || job?.status === 'running';

  const handleAnalyze = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      const startedJob = await analyzeResults(customerId);
      setJob(startedJob);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    if (!job?.analysis_id || !isRunning) return undefined;
    const timer = setInterval(async () => {
      try {
        const currentJob = await getAnalysis(job.analysis_id);
        setJob(currentJob);
      } catch (err) {
        setError(err.message);
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [job, isRunning]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 style={{ margin: '0 0 6px', fontSize: 20, color: '#e6edf3' }}>AI Phân tích Hạ tầng</h1>
          <div style={mutedStyle}>
            Gemini tương quan Terraform, KICS và Trivy để xác định chuỗi khai thác và thứ tự ưu tiên khắc phục.
          </div>
        </div>
        <button
          onClick={handleAnalyze}
          disabled={!customerId || loading || isRunning}
          style={{
            padding: '9px 18px',
            borderRadius: 7,
            border: '1px solid #388bfd',
            background: !customerId || loading || isRunning ? '#388bfd33' : '#1f6feb',
            color: '#fff',
            fontWeight: 700,
            fontSize: 13,
            cursor: !customerId || loading || isRunning ? 'not-allowed' : 'pointer',
          }}
        >
          {isRunning ? 'Đang phân tích...' : loading ? 'Đang gửi...' : 'Phân tích chuyên sâu'}
        </button>
      </div>

      {!customerId && (
        <div style={{ ...cardStyle, borderColor: '#388bfd66', color: '#79c0ff', fontSize: 13 }}>
          Đang dùng dữ liệu demo. Tải kết quả thật của một customer để chạy phân tích.
        </div>
      )}

      {error && (
        <div style={{ ...cardStyle, borderColor: '#f85149', color: '#ffa198', fontSize: 13 }}>
          {error}
        </div>
      )}

      {job?.status === 'error' && (
        <div style={{ ...cardStyle, borderColor: '#f85149' }}>
          <strong style={{ color: '#ffa198' }}>Phân tích lỗi</strong>
          <div style={{ ...mutedStyle, marginTop: 6 }}>{job.error}</div>
        </div>
      )}

      {job && !analysis && !error && job.status !== 'error' && (
        <div style={{ ...cardStyle, color: '#8b949e', fontSize: 13 }}>
          Job <strong>{job.analysis_id}</strong> đang ở trạng thái <strong>{job.status}</strong>.
        </div>
      )}

      {(job?.warnings || []).length > 0 && (
        <div style={{ ...cardStyle, borderColor: '#ef9f2766' }}>
          <strong style={{ color: '#ef9f27', fontSize: 13 }}>Lưu ý dữ liệu</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20, ...mutedStyle }}>
            {job.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
          </ul>
        </div>
      )}

      {analysis && (
        <>
          <div style={cardStyle}>
            <SectionTitle>Đánh giá tổng thể</SectionTitle>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <SeverityBadge severity={analysis.assessment.overall_risk} />
              {job?.model && <Chip>{job.model}</Chip>}
              {job?.cached && <Chip>cached</Chip>}
            </div>
            <p style={{ margin: 0, color: '#c9d1d9', fontSize: 13, lineHeight: 1.7 }}>
              {analysis.assessment.summary}
            </p>
            {(analysis.assessment.weaknesses || []).length > 0 && (
              <ul style={{ margin: '12px 0 0', paddingLeft: 20, ...mutedStyle }}>
                {analysis.assessment.weaknesses.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            )}
          </div>

          <div style={cardStyle}>
            <SectionTitle count={analysis.attack_vectors?.length || 0}>Attack vectors</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(analysis.attack_vectors || []).map((vector) => (
                <div key={vector.id} style={{
                  background: '#0d1117',
                  border: '1px solid #30363d',
                  borderRadius: 8,
                  padding: 14,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <SeverityBadge severity={vector.severity} />
                    <strong style={{ color: '#e6edf3', fontSize: 14 }}>{vector.name}</strong>
                    <Chip>{vector.confidence} confidence</Chip>
                  </div>
                  {vector.preconditions?.length > 0 && (
                    <div style={{ marginTop: 10, ...mutedStyle }}>
                      <strong>Điều kiện:</strong> {vector.preconditions.join(' · ')}
                    </div>
                  )}
                  <ol style={{ margin: '12px 0 0', paddingLeft: 22, color: '#c9d1d9', fontSize: 13, lineHeight: 1.7 }}>
                    {vector.steps.map((step, index) => (
                      <li key={index}>
                        {step.action}
                        {step.resource && <span style={mutedStyle}> — {step.resource}</span>}
                        {step.finding_id && <span style={mutedStyle}> — {step.finding_id}</span>}
                      </li>
                    ))}
                  </ol>
                  <div style={{ marginTop: 10, color: '#ffa198', fontSize: 12, lineHeight: 1.6 }}>
                    <strong>Impact:</strong> {vector.business_impact}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={cardStyle}>
            <SectionTitle count={analysis.correlations?.length || 0}>Tương quan lỗ hổng</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(analysis.correlations || []).map((correlation, index) => (
                <div key={index} style={{
                  background: '#0d1117',
                  border: '1px solid #30363d',
                  borderRadius: 8,
                  padding: 12,
                }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    {correlation.finding_ids.map((findingId) => <Chip key={findingId}>{findingId}</Chip>)}
                    <Chip>{correlation.confidence}</Chip>
                  </div>
                  <div style={{ color: '#e6edf3', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                    {correlation.relationship}
                  </div>
                  <div style={mutedStyle}>{correlation.rationale}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={cardStyle}>
            <SectionTitle count={analysis.recommendations?.length || 0}>Giải pháp ưu tiên</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(analysis.recommendations || []).map((recommendation, index) => (
                <div key={index} style={{
                  background: '#0d1117',
                  border: '1px solid #30363d',
                  borderRadius: 8,
                  padding: 12,
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Chip>{recommendation.priority}</Chip>
                    <strong style={{ color: '#e6edf3', fontSize: 13 }}>{recommendation.title}</strong>
                  </div>
                  <p style={{ margin: '8px 0 0', color: '#c9d1d9', fontSize: 13, lineHeight: 1.7 }}>
                    {recommendation.remediation}
                  </p>
                  {recommendation.terraform_hint && (
                    <pre style={{
                      marginTop: 10,
                      padding: 12,
                      background: '#010409',
                      border: '1px solid #21262d',
                      borderRadius: 7,
                      color: '#79c0ff',
                      fontSize: 12,
                      overflowX: 'auto',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {recommendation.terraform_hint}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
