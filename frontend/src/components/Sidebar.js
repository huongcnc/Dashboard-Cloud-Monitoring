import React from 'react';
import { NAV_ITEMS } from '../constants';

const styles = {
  sidebar: {
    width: 230,
    minHeight: '100vh',
    flexShrink: 0,
    background: 'var(--surface)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    position: 'sticky',
    top: 0,
    height: '100vh',
    overflowY: 'auto',
  },
  logo: {
    padding: '20px 20px 16px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  logoIcon: {
    width: 36, height: 36, borderRadius: 8,
    background: 'linear-gradient(135deg, var(--accent-strong), var(--accent))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 18,
  },
  nav: { flex: 1, padding: '8px 0' },
  footer: {
    padding: '16px 20px',
    borderTop: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', gap: 8,
  },
  footerIcon: {
    width: 28, height: 28, borderRadius: 6,
    background: 'var(--accent-tint)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14,
  },
};

export default function Sidebar({ activePage, onNavigate }) {
  return (
    <aside style={styles.sidebar}>
      {/* Logo */}
      <div style={styles.logo}>
        <div style={styles.logoIcon}>🛡</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>CloudGuard</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Monitor</div>
        </div>
      </div>

      {/* Navigation */}
      <nav style={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const isActive = activePage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 20px',
                background: isActive ? 'var(--accent-tint-weak)' : 'transparent',
                border: 'none',
                borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer',
                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                textAlign: 'left',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)';
              }}
              onMouseLeave={e => {
                if (!isActive) e.currentTarget.style.color = 'var(--text-muted)';
              }}
            >
              <span style={{ fontSize: 15, width: 20, textAlign: 'center' }}>{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={styles.footer}>
        <div style={styles.footerIcon}>🛡</div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>CloudGuard Monitor</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>v1.0.0</div>
        </div>
      </div>
    </aside>
  );
}
