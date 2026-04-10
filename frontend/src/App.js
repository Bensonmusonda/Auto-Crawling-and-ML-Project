import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import Sidebar from './components/Sidebar';
import DatasetExplorer from './components/DatasetExplorer';
import DataProcessing from './components/DataProcessing';
import MLTraining from './components/MLTraining';
import CrawlMonitor from './components/CrawlMonitor';
import Workflows from './components/Workflows';
import DocsViewer from './components/DocsViewer';
import Login from './components/Login';

function buildEventMessage(data) {
  if (data.event === 'progress') {
    return `${data.dataset_name} — ${data.data?.items_scraped} items, ${data.data?.pages_crawled} pages`;
  }
  if (data.event === 'started') return `Crawl started — ${data.url || ''}`;
  if (data.event === 'done') return `Crawl done`;
  if (data.event === 'error') return `Error: ${data.message || ''}`;
  if (data.status === 'completed') return `Job completed`;
  if (data.status === 'failed') return `Job failed: ${data.error || ''}`;
  if (data.status === 'started') return `Job started`;
  return JSON.stringify(data).substring(0, 80);
}

export default function App() {
  // ── Auth state ────────────────────────────────────────────────────────────
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => !!localStorage.getItem('auth_token')
  );
  const [authUsername, setAuthUsername] = useState(
    () => localStorage.getItem('auth_username') || ''
  );

  const handleAuthenticated = (username) => {
    setIsAuthenticated(true);
    setAuthUsername(username);
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_username');
    setIsAuthenticated(false);
    setAuthUsername('');
  };

  // ── Tab state — synced with URL search params ────────────────────────────
  const getInitialTab = () =>
    new URLSearchParams(window.location.search).get('tab') || 'datasets';
  const getInitialSlug = () =>
    new URLSearchParams(window.location.search).get('slug') || null;

  const [activeTab, setActiveTab] = useState(getInitialTab);
  const [activeSlug, setActiveSlug] = useState(getInitialSlug);

  const handleTabChange = useCallback((tabId) => {
    setActiveTab(tabId);
    setActiveSlug(null);
    const params = new URLSearchParams({ tab: tabId });
    window.history.replaceState(null, '', `?${params}`);
  }, []);

  const handleSlugChange = useCallback((slug) => {
    setActiveSlug(slug);
    const params = new URLSearchParams({ tab: 'docs', slug });
    window.history.replaceState(null, '', `?${params}`);
  }, []);

  // ── Lifted WebSocket state ──────────────────────────────
  const [liveJobs, setLiveJobs] = useState({});
  const [wsConnected, setWsConnected] = useState(false);
  const [events, setEvents] = useState([]);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  const connectWebSocket = useCallback(() => {
    // Don't open a second connection if already open
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket('ws://localhost:8000/websocket/crawl_events');
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        ws.send('*');
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        reconnectTimer.current = setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = () => {
        setWsConnected(false);
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          const jobId = data.job_id;
          if (!jobId) return;

          // Update live jobs
          setLiveJobs(prev => ({
            ...prev,
            [jobId]: {
              job_id: jobId,
              dataset_name: data.dataset_name
                || data.data?.dataset_name
                || prev[jobId]?.dataset_name
                || '—',
              pages_crawled: data.data?.pages_crawled
                ?? prev[jobId]?.pages_crawled
                ?? 0,
              items_scraped: data.data?.items_scraped
                ?? prev[jobId]?.items_scraped
                ?? 0,
              status: data.event === 'done'
                ? 'completed'
                : data.event === 'error'
                  ? 'failed'
                  : data.event === 'started'
                    ? 'running'
                    : prev[jobId]?.status || 'running',
              last_event: new Date().toLocaleTimeString(),
            }
          }));

          // Append to event log (cap at 200)
          setEvents(prev => [{
            time: new Date().toLocaleTimeString(),
            job_id: jobId,
            type: data.event || data.type || 'event',
            message: buildEventMessage(data),
            workflow_id: data.workflow_id,
            stage: data.stage,
            status: data.status,
            error: data.error,
          }, ...prev].slice(0, 200));

        } catch (_) { }
      };
    } catch (_) {
      setWsConnected(false);
    }
  }, []);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connectWebSocket]);

  // ── Routing ─────────────────────────────────────────────
  const renderContent = () => {
    switch (activeTab) {
      case 'datasets': return <DatasetExplorer />;
      case 'processing': return <DataProcessing />;
      case 'training': return <MLTraining />;
      case 'crawl':
        return (
          <CrawlMonitor
            liveJobs={liveJobs}
            wsConnected={wsConnected}
            events={events}
            onClearEvents={() => setEvents([])}
          />
        );
      case 'workflows':
        return <Workflows wsEvents={events} />;
      case 'docs':
        return <DocsViewer activeSlug={activeSlug} onSlugChange={handleSlugChange} />;
      default: return <DatasetExplorer />;
    }
  };

  // ── Auth gate ─────────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return <Login onAuthenticated={handleAuthenticated} />;
  }

  return (
    <div className="app-layout">
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        wsConnected={wsConnected}
        username={authUsername}
        onLogout={handleLogout}
      />
      <main className="main-content">
        {renderContent()}
      </main>
    </div>
  );
}