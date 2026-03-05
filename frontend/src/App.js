import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import Sidebar from './components/Sidebar';
import DatasetExplorer from './components/DatasetExplorer';
import DataProcessing from './components/DataProcessing';
import MLTraining from './components/MLTraining';
import CrawlMonitor from './components/CrawlMonitor';

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
  const [activeTab, setActiveTab] = useState('datasets');

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
      default: return <DatasetExplorer />;
    }
  };

  return (
    <div className="app-layout">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} wsConnected={wsConnected} />
      <main className="main-content">
        {renderContent()}
      </main>
    </div>
  );
}