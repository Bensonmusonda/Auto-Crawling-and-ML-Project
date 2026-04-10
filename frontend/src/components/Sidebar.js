import React from 'react';
import { Database, Wrench, Brain, Activity, GitBranch, BookOpen, LogOut, User } from 'lucide-react';

const tabs = [
  { id: 'datasets', label: 'Datasets', icon: Database },
  { id: 'processing', label: 'Processing', icon: Wrench },
  { id: 'training', label: 'ML Training', icon: Brain },
  { id: 'crawl', label: 'Crawl Monitor', icon: Activity },
  { id: 'workflows', label: 'Workflows', icon: GitBranch },
  { id: 'docs', label: 'Docs & Guides', icon: BookOpen },
];

export default function Sidebar({ activeTab, onTabChange, wsConnected, username, onLogout }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title">Data Platform</div>
        <div className="sidebar-subtitle">Acquisition &amp; ML</div>
      </div>

      <nav className="sidebar-nav">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-status">
          <span
            className="status-dot"
            style={{ background: wsConnected ? 'var(--color-success)' : 'var(--color-error)' }}
          />
          <span>{wsConnected ? 'Live' : 'Disconnected'}</span>
        </div>

        {username && (
          <div style={{ marginTop: 'var(--space-sm)', borderTop: '1px solid var(--border-dark)', paddingTop: 'var(--space-sm)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', marginBottom: 'var(--space-xs)', color: 'var(--text-tertiary)', fontSize: '11px', overflow: 'hidden' }}>
              <User size={12} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{username}</span>
            </div>
            <button
              id="sidebar-logout-btn"
              onClick={onLogout}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-xs)',
                padding: '5px 8px',
                background: 'var(--color-error-bg)',
                border: '1px solid #fecaca',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-error)',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <LogOut size={12} />
              Sign Out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}