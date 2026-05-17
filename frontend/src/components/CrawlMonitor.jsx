import React, { useState, useEffect } from 'react';
import { Activity, RefreshCw, Plus, Trash2, Wifi, WifiOff, XCircle } from 'lucide-react';

const OwnershipBadge = ({ ownerUsername }) => {
    if (!ownerUsername) return null;
    const isShared = ownerUsername === 'admin';
    return (
        <span style={{
            fontSize: '9px',
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: '4px',
            textTransform: 'uppercase',
            marginLeft: '8px',
            verticalAlign: 'middle',
            backgroundColor: isShared ? 'rgba(255, 255, 255, 0.05)' : 'rgba(79, 70, 229, 0.2)',
            color: isShared ? 'var(--text-tertiary)' : '#818cf8',
            border: `1px solid ${isShared ? 'rgba(255, 255, 255, 0.1)' : 'rgba(129, 140, 248, 0.3)'}`
        }}>
            {isShared ? 'Shared' : 'Yours'}
        </span>
    );
};

const API_BASE = 'http://localhost:8000';

export default function CrawlMonitor({ liveJobs = {}, wsConnected, events = [], onClearEvents }) {
    const [jobHistory, setJobHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [siteTiers, setSiteTiers] = useState({ tough: [], playwright: [], hybrid: [] });
    const [activeTier, setActiveTier] = useState('tough');
    const [newSite, setNewSite] = useState('');
    const [tiersLoading, setTiersLoading] = useState(false);
    const [tiersSaved, setTiersSaved] = useState(false);

    useEffect(() => {
        fetchJobHistory();
        fetchSiteTiers();
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

    // ── Site Tiers ────────────────────────────────────────────
    const fetchSiteTiers = async () => {
        setTiersLoading(true);
        try {
            const [resTough, resPlaywright, resHybrid] = await Promise.all([
                fetch(`${API_BASE}/api/crawl/tough-sites`),
                fetch(`${API_BASE}/api/crawl/playwright-sites`),
                fetch(`${API_BASE}/api/crawl/hybrid-sites`)
            ]);
            const [dataTough, dataPlay, dataHybrid] = await Promise.all([
                resTough.json(), resPlaywright.json(), resHybrid.json()
            ]);
            setSiteTiers({
                tough: dataTough.tough_sites || [],
                playwright: dataPlay.playwright_sites || [],
                hybrid: dataHybrid.hybrid_sites || []
            });
        } catch (_) { }
        finally { setTiersLoading(false); }
    };

    const saveSiteTier = async (tier, updatedSites) => {
        try {
            await fetch(`${API_BASE}/api/crawl/${tier}-sites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sites: updatedSites }), // Fixed 422 Error: uses 'sites' schema
            });
            setTiersSaved(true);
            setTimeout(() => setTiersSaved(false), 2000);
        } catch (_) { }
    };

    const addSite = () => {
        const site = newSite.trim().toLowerCase();
        const currentList = siteTiers[activeTier];
        if (!site || currentList.includes(site)) return;
        
        const updated = [...currentList, site];
        setSiteTiers(prev => ({ ...prev, [activeTier]: updated }));
        setNewSite('');
        saveSiteTier(activeTier, updated);
    };

    const removeSite = (site) => {
        const currentList = siteTiers[activeTier];
        const updated = currentList.filter(s => s !== site);
        setSiteTiers(prev => ({ ...prev, [activeTier]: updated }));
        saveSiteTier(activeTier, updated);
    };

    const stopJob = async (jobId) => {
        try {
            await fetch(`${API_BASE}/api/crawl/jobs/${jobId}/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e) {
            console.error('Failed to stop job:', e);
        }
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
                    Currently Running Crawls
                    {activeJobs.length > 0 && (
                        <span className="badge badge-success">{activeJobs.length}</span>
                    )}
                </div>

                {activeJobs.length === 0 ? (
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
                    <div 
                        className="responsive-grid"
                        style={{
                            maxHeight: 260,
                            overflowY: 'auto',
                            paddingRight: 4,
                            alignItems: 'start',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))'
                        }}
                    >
                        {activeJobs.map(job => (
                            <div key={job.job_id} className="card">
                                <div className="card-header">
                                    <span className="card-title">{job.dataset_name}</span>
                                    <div className="flex-row">
                                        <span className={`badge ${job.status === 'running' ? 'badge-success' :
                                                job.status === 'failed' ? 'badge-error' :
                                                    'badge-neutral'
                                            }`}>
                                            {job.status}
                                        </span>
                                        {job.status === 'running' && (
                                            <button 
                                                className="btn btn-secondary btn-sm"
                                                style={{ padding: '2px 6px', borderColor: 'transparent' }}
                                                onClick={() => stopJob(job.job_id)}
                                                title="Stop Crawl"
                                            >
                                                <XCircle size={14} color="var(--color-error)" />
                                            </button>
                                        )}
                                    </div>
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

            <div className="monitor-layout">
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
                                            <td style={{ fontWeight: 500 }}>
                                                {job.dataset_name}
                                                <OwnershipBadge ownerUsername={job.owner_username} />
                                            </td>
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

                {/* ── Right: Site Tier Routing ── */}
                <div className="card" style={{ position: 'sticky', top: 'var(--space-xl)' }}>
                    <div className="card-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                        <span className="card-title">Routing Rules</span>
                    </div>

                    <div style={{ display: 'flex', borderBottom: '1px solid var(--border-light)', marginBottom: 'var(--space-md)' }}>
                        <div 
                            style={{ flex: 1, textAlign: 'center', padding: '8px 0', fontSize: 13, cursor: 'pointer', borderBottom: activeTier === 'tough' ? '2px solid #111' : '1px solid transparent', fontWeight: activeTier === 'tough' ? 600 : 400, color: activeTier === 'tough' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                            onClick={() => setActiveTier('tough')}
                        >
                            Tough
                            <span className="badge badge-neutral" style={{ marginLeft: 6, fontSize: 9, padding: '2px 4px' }}>{siteTiers.tough.length}</span>
                        </div>
                        <div 
                            style={{ flex: 1, textAlign: 'center', padding: '8px 0', fontSize: 13, cursor: 'pointer', borderBottom: activeTier === 'playwright' ? '2px solid #111' : '1px solid transparent', fontWeight: activeTier === 'playwright' ? 600 : 400, color: activeTier === 'playwright' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                            onClick={() => setActiveTier('playwright')}
                        >
                            Playwright
                            <span className="badge badge-neutral" style={{ marginLeft: 6, fontSize: 9, padding: '2px 4px' }}>{siteTiers.playwright.length}</span>
                        </div>
                        <div 
                            style={{ flex: 1, textAlign: 'center', padding: '8px 0', fontSize: 13, cursor: 'pointer', borderBottom: activeTier === 'hybrid' ? '2px solid #111' : '1px solid transparent', fontWeight: activeTier === 'hybrid' ? 600 : 400, color: activeTier === 'hybrid' ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                            onClick={() => setActiveTier('hybrid')}
                        >
                            Hybrid
                            <span className="badge badge-neutral" style={{ marginLeft: 6, fontSize: 9, padding: '2px 4px' }}>{siteTiers.hybrid.length}</span>
                        </div>
                    </div>

                    <div className="card-body" style={{ paddingTop: 0 }}>
                        <p style={{
                            fontSize: 12, color: 'var(--text-secondary)',
                            marginBottom: 'var(--space-md)'
                        }}>
                            {activeTier === 'tough' && "Domains routed through ScraperAPI. Bypasses hard IP blocks."}
                            {activeTier === 'playwright' && "Domains rendered in Playwright (browser mode) by Scrapy. Handles SPAs."}
                            {activeTier === 'hybrid' && "Domains rendered via ScraperAPI JS rendering. Max bypassing."}
                        </p>

                        <div className="flex-row" style={{ marginBottom: 'var(--space-md)' }}>
                            <input
                                className="form-input"
                                placeholder={`e.g. ${activeTier === 'tough' ? 'linkedin.com' : activeTier === 'playwright' ? 'youtube.com' : 'zillow.com'}`}
                                value={newSite}
                                onChange={e => setNewSite(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && addSite()}
                                style={{ flex: 1 }}
                            />
                            <button className="btn btn-primary" onClick={addSite}>
                                <Plus size={14} />
                            </button>
                        </div>

                        {tiersLoading ? (
                            <div style={{ textAlign: 'center', padding: 'var(--space-md)' }}>
                                <span className="spinner" />
                            </div>
                        ) : siteTiers[activeTier].length === 0 ? (
                            <div className="empty-state" style={{ padding: 'var(--space-md)' }}>
                                <div className="empty-state-text">No sites in this list</div>
                            </div>
                        ) : siteTiers[activeTier].map(site => (
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
                                    onClick={() => removeSite(site)}
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        ))}

                        {tiersSaved && (
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