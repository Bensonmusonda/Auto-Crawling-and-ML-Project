import React, { useState, useEffect } from 'react';
import { Activity, RefreshCw, Plus, Trash2, Wifi, WifiOff } from 'lucide-react';

const API_BASE = 'http://localhost:8000';

export default function CrawlMonitor({ liveJobs = {}, wsConnected, events = [], onClearEvents }) {
    const [jobHistory, setJobHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [toughSites, setToughSites] = useState([]);
    const [newSite, setNewSite] = useState('');
    const [toughSitesLoading, setToughSitesLoading] = useState(false);
    const [toughSitesSaved, setToughSitesSaved] = useState(false);

    useEffect(() => {
        fetchJobHistory();
        fetchToughSites();
    }, []);

    // ── Job History ────────────────────────────────────────────
    const fetchJobHistory = async () => {
        setHistoryLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/crawl/jobs`);
            const data = await res.json();
            setJobHistory(data);
        } catch (_) { }
        finally { setHistoryLoading(false); }
    };

    // ── Tough Sites ────────────────────────────────────────────
    const fetchToughSites = async () => {
        setToughSitesLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/crawl/tough-sites`);
            const data = await res.json();
            setToughSites(data.tough_sites || []);
        } catch (_) { }
        finally { setToughSitesLoading(false); }
    };

    const saveToughSites = async (sites) => {
        try {
            await fetch(`${API_BASE}/api/crawl/tough-sites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tough_sites: sites }),
            });
            setToughSitesSaved(true);
            setTimeout(() => setToughSitesSaved(false), 2000);
        } catch (_) { }
    };

    const addToughSite = () => {
        const site = newSite.trim().toLowerCase();
        if (!site || toughSites.includes(site)) return;
        const updated = [...toughSites, site];
        setToughSites(updated);
        setNewSite('');
        saveToughSites(updated);
    };

    const removeToughSite = (site) => {
        const updated = toughSites.filter(s => s !== site);
        setToughSites(updated);
        saveToughSites(updated);
    };

    const liveJobsList = Object.values(liveJobs);
    const activeJobs = liveJobsList.filter(j => j.status === 'running');

    return (
        <div className="page-container">
            <div className="page-header flex-between">
                <div>
                    <h1 className="page-title">Crawl Monitor</h1>
                    <p className="page-description">Live crawl feed, job history, and spider configuration</p>
                </div>
                <div className="flex-row">
                    <span className={`badge ${wsConnected ? 'badge-success' : 'badge-error'}`}>
                        {wsConnected
                            ? <><Wifi size={10} /> Live</>
                            : <><WifiOff size={10} /> Disconnected</>}
                    </span>
                    <button className="btn btn-secondary" onClick={fetchJobHistory}>
                        <RefreshCw size={14} /> Refresh
                    </button>
                </div>
            </div>

            {/* ── Live Job Cards ── */}
            <div style={{ marginBottom: 'var(--space-md)' }}>
                <div style={{
                    fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                    letterSpacing: '0.04em', color: 'var(--text-secondary)',
                    marginBottom: 'var(--space-sm)', display: 'flex',
                    alignItems: 'center', gap: 8
                }}>
                    Active Jobs
                    {activeJobs.length > 0 && (
                        <span className="badge badge-success">{activeJobs.length}</span>
                    )}
                </div>

                {liveJobsList.length === 0 ? (
                    <div className="card">
                        <div className="card-body empty-state">
                            <Activity />
                            <div className="empty-state-title">No active crawls</div>
                            <div className="empty-state-text">
                                Start a crawl from the Chrome extension — live progress will appear here
                            </div>
                        </div>
                    </div>
                ) : (
                    <div style={{
                        maxHeight: 260,
                        overflowY: 'auto',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, 1fr)',
                        gap: 'var(--space-md)',
                        paddingRight: 4  /* prevents scrollbar from overlapping cards */
                    }}>
                        {liveJobsList.map(job => (
                            <div key={job.job_id} className="card">
                                <div className="card-header">
                                    <span className="card-title">{job.dataset_name}</span>
                                    <span className={`badge ${job.status === 'running' ? 'badge-success' :
                                            job.status === 'failed' ? 'badge-error' :
                                                'badge-neutral'
                                        }`}>
                                        {job.status}
                                    </span>
                                </div>
                                <div className="card-body">
                                    <div className="grid-2" style={{ gap: 'var(--space-sm)' }}>
                                        <div className="stat-card">
                                            <div className="stat-label">Pages</div>
                                            <div className="stat-value" style={{ fontSize: 20 }}>
                                                {job.pages_crawled}
                                            </div>
                                        </div>
                                        <div className="stat-card">
                                            <div className="stat-label">Items</div>
                                            <div className="stat-value info" style={{ fontSize: 20 }}>
                                                {job.items_scraped}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{
                                        fontSize: 10, color: 'var(--text-muted)',
                                        marginTop: 'var(--space-sm)', fontFamily: 'monospace'
                                    }}>
                                        {job.job_id.substring(0, 16)}… · last event {job.last_event}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="grid-2" style={{ alignItems: 'start' }}>
                {/* ── Left: History + Event Log ── */}
                <div>
                    <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
                        <div className="card-header">
                            <span className="card-title">Job History</span>
                            <span className="badge badge-neutral">{jobHistory.length}</span>
                        </div>
                        <div className="data-table-wrapper" style={{ maxHeight: 320 }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Dataset</th>
                                        <th>Items</th>
                                        <th>Started</th>
                                        <th>Job ID</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {historyLoading ? (
                                        <tr>
                                            <td colSpan={4} style={{ textAlign: 'center', padding: 20 }}>
                                                <span className="spinner" />
                                            </td>
                                        </tr>
                                    ) : jobHistory.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} style={{
                                                textAlign: 'center', padding: 20,
                                                color: 'var(--text-muted)', fontSize: 12
                                            }}>
                                                No jobs found
                                            </td>
                                        </tr>
                                    ) : jobHistory.map((job, i) => (
                                        <tr key={i}>
                                            <td style={{ fontWeight: 500 }}>{job.dataset_name}</td>
                                            <td className="mono">{job.item_count}</td>
                                            <td style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                                                {job.started_at
                                                    ? new Date(job.started_at).toLocaleString()
                                                    : '—'}
                                            </td>
                                            <td className="mono" style={{
                                                fontSize: 10, color: 'var(--text-muted)'
                                            }}>
                                                {job.job_id
                                                    ? job.job_id.substring(0, 12) + '…'
                                                    : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Event Log */}
                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Event Log</span>
                            {events.length > 0 && (
                                <button className="btn btn-secondary btn-sm" onClick={onClearEvents}>
                                    Clear
                                </button>
                            )}
                        </div>
                        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                            {events.length === 0 ? (
                                <div className="card-body empty-state" style={{ padding: 'var(--space-lg)' }}>
                                    <div className="empty-state-text">Waiting for events…</div>
                                </div>
                            ) : (
                                <div className="card-body" style={{
                                    padding: 'var(--space-sm) var(--space-md)'
                                }}>
                                    {events.map((ev, i) => (
                                        <div key={i} className="log-entry info">
                                            <span className="log-time">{ev.time}</span>
                                            <span className="mono" style={{
                                                fontSize: 10, color: 'var(--text-muted)', marginRight: 6
                                            }}>
                                                {ev.job_id?.substring(0, 8)}
                                            </span>
                                            <span>{ev.message}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Right: Tough Sites ── */}
                <div className="card" style={{ position: 'sticky', top: 'var(--space-xl)' }}>
                    <div className="card-header">
                        <span className="card-title">Tough Sites</span>
                        <span className="badge badge-neutral">{toughSites.length}</span>
                    </div>
                    <div className="card-body">
                        <p style={{
                            fontSize: 12, color: 'var(--text-secondary)',
                            marginBottom: 'var(--space-md)'
                        }}>
                            Domains routed through ScraperAPI. Changes take effect on the next crawl.
                        </p>

                        <div className="flex-row" style={{ marginBottom: 'var(--space-md)' }}>
                            <input
                                className="form-input"
                                placeholder="e.g. linkedin.com"
                                value={newSite}
                                onChange={e => setNewSite(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && addToughSite()}
                                style={{ flex: 1 }}
                            />
                            <button className="btn btn-primary" onClick={addToughSite}>
                                <Plus size={14} />
                            </button>
                        </div>

                        {toughSitesLoading ? (
                            <div style={{ textAlign: 'center', padding: 'var(--space-md)' }}>
                                <span className="spinner" />
                            </div>
                        ) : toughSites.length === 0 ? (
                            <div className="empty-state" style={{ padding: 'var(--space-md)' }}>
                                <div className="empty-state-text">No tough sites configured</div>
                            </div>
                        ) : toughSites.map(site => (
                            <div key={site} className="flex-between" style={{
                                padding: '8px 10px',
                                border: '1px solid var(--border-light)',
                                borderRadius: 'var(--radius-md)',
                                marginBottom: 6,
                                background: 'var(--bg-secondary)',
                            }}>
                                <span className="mono" style={{ fontSize: 13 }}>{site}</span>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => removeToughSite(site)}
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        ))}

                        {toughSitesSaved && (
                            <div className="badge badge-success" style={{ marginTop: 'var(--space-sm)' }}>
                                Saved
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}