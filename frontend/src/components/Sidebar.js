import React from 'react';
import { Database, Wrench, Brain, Activity } from 'lucide-react';

const tabs = [
  { id: 'datasets', label: 'Datasets', icon: Database },
  { id: 'processing', label: 'Processing', icon: Wrench },
  { id: 'training', label: 'ML Training', icon: Brain },
  { id: 'crawl', label: 'Crawl Monitor', icon: Activity }
];

export default function Sidebar({ activeTab, onTabChange, wsConnected }) {
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
      </div>
    </aside>
  );
}