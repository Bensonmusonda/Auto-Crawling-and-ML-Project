import React, { useState, useEffect, useCallback } from 'react';
import {
    ArrowLeft, Play, Edit2, Trash2, CheckCircle, XCircle,
    Clock, ChevronDown, ChevronUp, ExternalLink, Database,
    Cpu, Globe, Settings, Terminal, RefreshCw, AlertTriangle
} from 'lucide-react';

const API_BASE = 'http://localhost:8000';

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
    if (!status) return <span className="badge badge-neutral">Never run</span>;
    const map = { completed: 'badge-success', failed: 'badge-error', running: 'badge-warning', running_: 'badge-warning' };
    return <span className={`badge ${map[status] || 'badge-neutral'}`}>{status}</span>;
}

function StageIcon({ stage }) {
    const props = { size: 14 };
    if (stage === 'crawl') return <Globe {...props} />;
    if (stage === 'processing') return <Settings {...props} />;
    if (stage === 'ml') return <Cpu {...props} />;
    return <Database {...props} />;
}

function StageName({ stage }) {
    if (stage === 'ml') return 'ML Training';
    return stage.charAt(0).toUpperCase() + stage.slice(1);
}

function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// ── Config summary renderers ──────────────────────────────────────────────────

function CrawlConfigSummary({ config }) {
    if (!config) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No config</span>;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <ConfigPill label="URL" value={config.start_url || '—'} mono truncate />
                <ConfigPill label="Type" value={config.crawl_type || 'flat'} />
                {config.pagination && (
                    <ConfigPill label="Pagination" value={`${config.pagination.max_pages || '?'} pages`} />
                )}
            </div>
            {config.container_selector && (
                <ConfigPill label="Container" value={config.container_selector} mono />
            )}
            {config.item_selectors && Object.keys(config.item_selectors).length > 0 && (
                <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)', marginBottom: 4 }}>
                        Item Selectors
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {Object.entries(config.item_selectors).map(([k, v]) => (
                            <span key={k} style={{
                                background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
                                padding: '2px 8px', fontSize: 11, fontFamily: 'monospace',
                                color: 'var(--text-primary)'
                            }}>
                                <span style={{ color: 'var(--text-tertiary)' }}>{k}: </span>{v}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function ProcessingConfigSummary({ config }) {
    const steps = config?.steps || [];
    if (steps.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No steps configured</span>;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {steps.map((step, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{
                        width: 18, height: 18, borderRadius: '50%', background: 'var(--bg-dark)',
                        color: 'var(--text-inverse)', fontSize: 10, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1
                    }}>{i + 1}</span>
                    <div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{step.label}</span>
                        {step.params && Object.keys(step.params).length > 0 && (
                            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 6 }}>
                                ({Object.entries(step.params).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ')})
                            </span>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

function MLConfigSummary({ config }) {
    if (!config) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>No config</span>;
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <ConfigPill label="Model" value={(config.model_type || '—').replace(/_/g, ' ')} />
            <ConfigPill label="Target" value={config.target_column || '—'} mono />
            <ConfigPill label="Auto-tune" value={config.auto_tune ? 'Yes' : 'No'} />
        </div>
    );
}

function ConfigPill({ label, value, mono, truncate }) {
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'var(--bg-secondary)', border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 11
        }}>
            <span style={{ color: 'var(--text-tertiary)', fontWeight: 600 }}>{label}</span>
            <span style={{
                color: 'var(--text-primary)',
                fontFamily: mono ? 'monospace' : 'inherit',
                maxWidth: truncate ? 200 : undefined,
                overflow: truncate ? 'hidden' : undefined,
                textOverflow: truncate ? 'ellipsis' : undefined,
                whiteSpace: truncate ? 'nowrap' : undefined,
            }}>{value}</span>
        </span>
    );
}

// ── Stage Logs Dropdown ───────────────────────────────────────────────────────

function StageLogsDropdown({ runId, stage, stageResult }) {
    const [open, setOpen] = useState(false);
    const [logs, setLogs] = useState(null);
    const [loading, setLoading] = useState(false);

    const fetchLogs = async () => {
        if (logs !== null) { setOpen(o => !o); return; }
        setOpen(true);
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/workflows/runs/${runId}/stage-logs/${stage}`);
            if (!res.ok) throw new Error(`${res.status}`);
            const data = await res.json();
            setLogs(data.logs || []);
        } catch (err) {
            setLogs([{ level: 'error', message: `Could not load logs: ${err.message}`, timestamp: null }]);
        } finally {
            setLoading(false);
        }
    };

    const statusOk = stageResult?.status === 'completed';
    const hasError = stageResult?.status === 'failed';

    return (
        <div>
            <button
                onClick={fetchLogs}
                style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 11, color: 'var(--text-tertiary)', padding: '2px 0',
                    fontFamily: 'inherit'
                }}
            >
                <Terminal size={11} />
                Logs
                {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>

            {open && (
                <div style={{
                    marginTop: 6,
                    background: 'var(--bg-dark)',
                    borderRadius: 'var(--radius-md)',
                    padding: '10px 12px',
                    fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                    fontSize: 11,
                    maxHeight: 200,
                    overflowY: 'auto',
                }}>
                    {loading ? (
                        <span style={{ color: 'var(--text-muted)' }}>
                            <span className="spinner" style={{ width: 10, height: 10, marginRight: 6 }} />
                            Loading…
                        </span>
                    ) : !logs || logs.length === 0 ? (
                        <span style={{ color: 'var(--text-muted)' }}>No log entries found.</span>
                    ) : (
                        logs.map((entry, i) => {
                            const color = entry.level === 'error'
                                ? 'var(--color-error)'
                                : entry.level === 'warning'
                                    ? 'var(--color-warning)'
                                    : 'var(--text-muted)';
                            return (
                                <div key={i} style={{ color, lineHeight: 1.6, marginBottom: 1 }}>
                                    {entry.timestamp && (
                                        <span style={{ color: 'var(--text-tertiary)', marginRight: 8 }}>
                                            {new Date(entry.timestamp).toLocaleTimeString()}
                                        </span>
                                    )}
                                    {entry.message}
                                </div>
                            );
                        })
                    )}
                    {/* Always show the stage's stored message/error too */}
                    {hasError && stageResult?.message && (
                        <div style={{ color: 'var(--color-error)', marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6 }}>
                            <AlertTriangle size={10} style={{ marginRight: 4 }} />
                            {stageResult.message}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Run History Row ───────────────────────────────────────────────────────────

function RunRow({ run, defaultOpen }) {
    const [open, setOpen] = useState(defaultOpen || false);
    const stageResults = run.stage_results || {};
    const stages = ['crawl', 'processing', 'ml'];

    const statusColor = run.status === 'completed'
        ? 'var(--color-success)'
        : run.status === 'failed'
            ? 'var(--color-error)'
            : 'var(--color-warning)';

    return (
        <div style={{
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            background: 'var(--bg-primary)',
        }}>
            {/* Run header row */}
            <div
                onClick={() => setOpen(o => !o)}
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', cursor: 'pointer',
                    background: open ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                    transition: 'background 0.12s',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: statusColor, flexShrink: 0
                    }} />
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                            {run.run_id?.slice(0, 12) || '—'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                            {formatDate(run.started_at)}
                            {run.duration && <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>({run.duration})</span>}
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Stage chips summary */}
                    <div style={{ display: 'flex', gap: 4 }}>
                        {stages.map(stage => {
                            const s = stageResults[stage];
                            if (!s) return null;
                            const ok = s.status === 'completed';
                            return (
                                <span key={stage}
                                    className={`badge ${ok ? 'badge-success' : 'badge-error'}`}
                                    style={{ fontSize: 10, gap: 3 }}>
                                    {ok
                                        ? <CheckCircle size={9} />
                                        : <XCircle size={9} />}
                                    <StageName stage={stage} />
                                </span>
                            );
                        })}
                    </div>
                    <StatusBadge status={run.status} />
                    {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </div>
            </div>

            {/* Expanded stage breakdown */}
            {open && (
                <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border-light)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {stages.map(stage => {
                            const s = stageResults[stage];
                            if (!s) return null;
                            const ok = s.status === 'completed';

                            return (
                                <div key={stage} style={{
                                    background: 'var(--bg-secondary)',
                                    border: `1px solid ${ok ? 'var(--border-light)' : 'rgba(var(--color-error-rgb,220,38,38),0.25)'}`,
                                    borderRadius: 'var(--radius-md)',
                                    padding: '10px 12px',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <StageIcon stage={stage} />
                                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                                                <StageName stage={stage} />
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            {ok
                                                ? <CheckCircle size={13} color="var(--color-success)" />
                                                : <XCircle size={13} color="var(--color-error)" />}
                                        </div>
                                    </div>

                                    {/* Stage metrics */}
                                    {s.metrics && Object.keys(s.metrics).length > 0 && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                                            {Object.entries(s.metrics).map(([k, v]) => (
                                                <ConfigPill key={k} label={k.replace(/_/g, ' ')} value={typeof v === 'number' ? v.toLocaleString() : String(v)} />
                                            ))}
                                        </div>
                                    )}

                                    {/* Output CSV / model link */}
                                    {stage === 'ml' && run.model_job_id && (
                                        <div style={{ marginBottom: 8 }}>
                                            <a
                                                href={`?tab=training&jobId=${run.model_job_id}`}
                                                style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                                    fontSize: 11, color: 'var(--text-primary)',
                                                    textDecoration: 'none', fontWeight: 600,
                                                    background: 'var(--bg-tertiary)',
                                                    padding: '3px 8px', borderRadius: 'var(--radius-sm)',
                                                    border: '1px solid var(--border-light)'
                                                }}
                                            >
                                                <ExternalLink size={10} /> View trained model
                                            </a>
                                        </div>
                                    )}

                                    {stage === 'processing' && run.output_csv && (
                                        <div style={{ marginBottom: 8 }}>
                                            <a
                                                href={`${API_BASE}/api/datasets/download?path=${encodeURIComponent(run.output_csv)}`}
                                                target="_blank"
                                                rel="noreferrer"
                                                style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                                    fontSize: 11, color: 'var(--text-primary)',
                                                    textDecoration: 'none', fontWeight: 600,
                                                    background: 'var(--bg-tertiary)',
                                                    padding: '3px 8px', borderRadius: 'var(--radius-sm)',
                                                    border: '1px solid var(--border-light)'
                                                }}
                                            >
                                                <Database size={10} /> Download output CSV
                                            </a>
                                        </div>
                                    )}

                                    {/* Log dropdown */}
                                    <StageLogsDropdown
                                        runId={run.run_id}
                                        stage={stage}
                                        stageResult={s}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Main WorkflowDetail ───────────────────────────────────────────────────────

export default function WorkflowDetail({
    workflow,
    onBack,
    onEdit,
    onDelete,
    onRun,
    isRunning,
    runningInfo,
    wsEvents,
}) {
    const [runs, setRuns] = useState([]);
    const [loadingRuns, setLoadingRuns] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [limit, setLimit] = useState(10);
    const [activeSection, setActiveSection] = useState('history'); // 'history' | 'config'

    const fetchRuns = useCallback(async (lim = 10, silent = false) => {
        if (!silent) lim === 10 ? setLoadingRuns(true) : setLoadingMore(true);
        try {
            const res = await fetch(`${API_BASE}/api/workflows/${workflow.id}/history?limit=${lim}`);
            const data = await res.json();
            setRuns(data);
            setHasMore(data.length === lim);
        } catch (_) { }
        finally {
            setLoadingRuns(false);
            setLoadingMore(false);
        }
    }, [workflow.id]);

    useEffect(() => {
        fetchRuns(10);
    }, [fetchRuns]);

    // Refresh on completed/failed ws event for this workflow
    useEffect(() => {
        if (!wsEvents?.length) return;
        const latest = wsEvents[0];
        if (latest?.workflow_id !== workflow.id) return;
        if (latest.status === 'completed' || latest.status === 'failed') {
            fetchRuns(limit, true);
        }
    }, [wsEvents, workflow.id, limit, fetchRuns]);

    const loadMore = () => {
        const next = limit + 10;
        setLimit(next);
        fetchRuns(next);
    };

    const stages = workflow.stages || {};
    const enabledStages = ['crawl', 'processing', 'ml'].filter(s => stages[s]?.enabled);

    // Last run stats
    const lastRun = runs[0];
    const totalRuns = runs.length;
    const successCount = runs.filter(r => r.status === 'completed').length;
    const failCount = runs.filter(r => r.status === 'failed').length;

    return (
        <div className="page-container">
            {/* ── Back + Title ── */}
            <div style={{ marginBottom: 'var(--space-lg)' }}>
                <button
                    className="btn btn-secondary btn-sm"
                    onClick={onBack}
                    style={{ marginBottom: 'var(--space-md)' }}
                >
                    <ArrowLeft size={13} /> Back to Workflows
                </button>

                <div className="flex-between">
                    <div>
                        <h1 className="page-title" style={{ marginBottom: 4 }}>{workflow.name}</h1>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                                fontSize: 12, fontFamily: 'monospace',
                                color: 'var(--text-tertiary)', background: 'var(--bg-secondary)',
                                padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                                border: '1px solid var(--border-light)'
                            }}>
                                {workflow.dataset_name}
                            </span>
                            {enabledStages.map(s => (
                                <span key={s} className="badge badge-info" style={{ fontSize: 10 }}>
                                    <StageName stage={s} />
                                </span>
                            ))}
                            <StatusBadge status={isRunning ? 'running' : workflow.last_run_status} />
                        </div>
                    </div>

                    <div className="flex-row">
                        <button className="btn btn-secondary btn-sm"
                            onClick={() => onEdit(workflow)} disabled={isRunning}>
                            <Edit2 size={12} /> Edit
                        </button>
                        <button className="btn btn-secondary btn-sm"
                            onClick={() => onDelete(workflow.id)} disabled={isRunning}>
                            <Trash2 size={12} />
                        </button>
                        <button
                            className={`btn btn-sm ${isRunning ? 'btn-secondary' : 'btn-primary'}`}
                            onClick={() => onRun(workflow.id)}
                            disabled={isRunning}
                        >
                            {isRunning
                                ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Running…</>
                                : <><Play size={12} /> Run</>}
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Live run banner ── */}
            {isRunning && runningInfo && (
                <div className={`log-entry ${runningInfo.status === 'failed' ? 'error' : 'info'}`}
                    style={{ marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="spinner" style={{ width: 12, height: 12 }} />
                    {runningInfo.stage && (
                        <span className="badge badge-neutral" style={{ fontSize: 10 }}>
                            {runningInfo.stage}
                        </span>
                    )}
                    <span style={{ fontSize: 12 }}>{runningInfo.message || 'Running…'}</span>
                </div>
            )}

            {/* ── Stats row ── */}
            {!loadingRuns && (
                <div className="grid-4" style={{ marginBottom: 'var(--space-lg)' }}>
                    <div className="stat-card">
                        <div className="stat-label">Total Runs</div>
                        <div className="stat-value">{totalRuns}{hasMore ? '+' : ''}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">Successful</div>
                        <div className="stat-value success">{successCount}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">Failed</div>
                        <div className="stat-value error">{failCount}</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-label">Last Run</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginTop: 4 }}>
                            {lastRun ? formatDate(lastRun.started_at) : '—'}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Section tabs ── */}
            <div className="tab-bar">
                <button
                    className={`tab-btn ${activeSection === 'history' ? 'active' : ''}`}
                    onClick={() => setActiveSection('history')}
                >
                    <Clock size={13} style={{ marginRight: 5 }} />
                    Run History
                </button>
                <button
                    className={`tab-btn ${activeSection === 'config' ? 'active' : ''}`}
                    onClick={() => setActiveSection('config')}
                >
                    <Settings size={13} style={{ marginRight: 5 }} />
                    Configuration
                </button>
            </div>

            {/* ── Run History ── */}
            {activeSection === 'history' && (
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            Showing last {runs.length} run{runs.length !== 1 ? 's' : ''}
                        </span>
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => fetchRuns(limit, false)}
                        >
                            <RefreshCw size={11} /> Refresh
                        </button>
                    </div>

                    {loadingRuns ? (
                        <div className="card">
                            <div className="card-body empty-state">
                                <span className="spinner" style={{ width: 24, height: 24 }} />
                            </div>
                        </div>
                    ) : runs.length === 0 ? (
                        <div className="card">
                            <div className="card-body empty-state">
                                <Clock style={{ width: 40, height: 40, opacity: 0.3 }} />
                                <div className="empty-state-title">No runs yet</div>
                                <div className="empty-state-text">Hit "Run" to execute this workflow for the first time</div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {runs.map((run, i) => (
                                <RunRow key={run.run_id} run={run} defaultOpen={i === 0 && run.status === 'failed'} />
                            ))}

                            {hasMore && (
                                <button
                                    className="btn btn-secondary"
                                    onClick={loadMore}
                                    disabled={loadingMore}
                                    style={{ alignSelf: 'center', marginTop: 4 }}
                                >
                                    {loadingMore
                                        ? <><span className="spinner" /> Loading…</>
                                        : 'Load more runs'}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── Configuration ── */}
            {activeSection === 'config' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    {['crawl', 'processing', 'ml'].map(stageName => {
                        const stageConf = stages[stageName];
                        const enabled = stageConf?.enabled;
                        return (
                            <div key={stageName} className="card" style={{ opacity: enabled ? 1 : 0.5 }}>
                                <div className="card-header">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <StageIcon stage={stageName} />
                                        <span className="card-title">
                                            <StageName stage={stageName} />
                                        </span>
                                        {!enabled && <span className="badge badge-neutral">disabled</span>}
                                    </div>
                                </div>
                                {enabled && (
                                    <div className="card-body">
                                        {stageName === 'crawl' && <CrawlConfigSummary config={stageConf.config} />}
                                        {stageName === 'processing' && <ProcessingConfigSummary config={stageConf.config} />}
                                        {stageName === 'ml' && <MLConfigSummary config={stageConf.config} />}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Metadata</span>
                        </div>
                        <div className="card-body">
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                <ConfigPill label="ID" value={String(workflow.id)} />
                                <ConfigPill label="Created" value={formatDate(workflow.created_at)} />
                                <ConfigPill label="Last run" value={formatDate(workflow.last_run_at)} />
                                <ConfigPill label="Status" value={workflow.last_run_status || 'never run'} />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
