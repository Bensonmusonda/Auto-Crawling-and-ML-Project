import React, { useState, useEffect } from 'react';
import {
    Play, Plus, Trash2, Edit2, CheckCircle, XCircle, ChevronDown, ChevronUp, Activity, History
} from 'lucide-react';

const API_BASE = 'http://localhost:8000';

const AVAILABLE_STEPS = [
    { id: 'drop_nulls', label: 'Drop Null Rows', params: [{ key: 'subset', label: 'Columns (comma-separated)', type: 'text', default: '' }] },
    { id: 'fill_missing', label: 'Fill Missing Values', params: [{ key: 'strategy', label: 'Strategy', type: 'select', options: ['mean', 'median', 'mode', 'constant'], default: 'mean' }, { key: 'fill_value', label: 'Constant value', type: 'text', default: '0' }] },
    { id: 'remove_duplicates', label: 'Remove Duplicates', params: [{ key: 'subset', label: 'Columns (comma-separated)', type: 'text', default: '' }] },
    { id: 'normalize', label: 'Normalize', params: [{ key: 'method', label: 'Method', type: 'select', options: ['minmax', 'z_score', 'robust'], default: 'minmax' }, { key: 'columns', label: 'Columns', type: 'text', default: '' }] },
    { id: 'encode_categorical', label: 'Encode Categorical', params: [{ key: 'method', label: 'Method', type: 'select', options: ['label', 'one_hot'], default: 'label' }, { key: 'columns', label: 'Columns', type: 'text', default: '' }] },
    { id: 'drop_columns', label: 'Drop Columns', params: [{ key: 'columns', label: 'Columns to drop', type: 'text', default: '' }] },
    { id: 'clean_numeric_column', label: 'Clean Numeric Column', params: [{ key: 'column', label: 'Column name', type: 'text', default: '' }, { key: 'strip_chars', label: 'Characters to strip (e.g. US $, out of 5 stars)', type: 'text', default: '' }] },
];

const ML_MODELS = ['random_forest', 'logistic_regression', 'linear_regression', 'gradient_boosting', 'svm'];

const emptyStages = () => ({
    crawl: {
        enabled: true,
        config: {
            start_url: '',
            crawl_type: 'flat',
            container_selector: '',
            item_selectors: {},
            link_selector: '',
            pagination: { enabled: false, method: 'selector', selector: '', max_pages: 3 }
        }
    },
    processing: { enabled: true, config: { steps: [] } },
    ml: { enabled: true, config: { target_column: '', model_type: 'random_forest', auto_tune: true, params: {} } }
});

function StatusBadge({ status }) {
    if (!status) return <span className="badge badge-neutral">Never run</span>;
    const map = { completed: 'badge-success', failed: 'badge-error', running: 'badge-warning' };
    return <span className={`badge ${map[status] || 'badge-neutral'}`}>{status}</span>;
}

function StageChip({ label, enabled }) {
    return (
        <span className={`badge ${enabled ? 'badge-info' : 'badge-neutral'}`}
            style={{ opacity: enabled ? 1 : 0.4 }}>
            {label}
        </span>
    );
}

export default function Workflows({ wsEvents = [] }) {
    const [workflows, setWorkflows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showBuilder, setShowBuilder] = useState(false);
    const [editingWorkflow, setEditingWorkflow] = useState(null);

    // Builder state
    const [wfName, setWfName] = useState('');
    const [wfDataset, setWfDataset] = useState('');
    const [stages, setStages] = useState(emptyStages());
    const [expandedStage, setExpandedStage] = useState('crawl');
    const [saving, setSaving] = useState(false);

    const [crawlConfigs, setCrawlConfigs] = useState([]);
    const [loadingConfigs, setLoadingConfigs] = useState(false);

    // Running jobs — derived from wsEvents prop
    const [runningWorkflows, setRunningWorkflows] = useState({});
    // Run history — { [wf.id]: { open: bool, loading: bool, runs: [] } }
    const [historyState, setHistoryState] = useState({});

    useEffect(() => {
        fetchWorkflows();
    }, []);

    // Track workflow run events from lifted WebSocket
    useEffect(() => {
        if (!wsEvents.length) return;
        const latest = wsEvents[0];
        if (latest?.type !== 'workflow') return;

        const wfId = latest.workflow_id;
        setRunningWorkflows(prev => ({
            ...prev,
            [wfId]: {
                status: latest.status,
                stage: latest.stage,
                message: latest.message,
                error: latest.error,
            }
        }));

        // Refresh list on completion/failure
        if (latest.status === 'completed' || latest.status === 'failed') {
            fetchWorkflows();
            setRunningWorkflows(prev => {
                const next = { ...prev };
                delete next[wfId];
                return next;
            });
        }
    }, [wsEvents]);

    const [workflowColumns, setWorkflowColumns] = useState([]);

    // Add this function:
    const fetchWorkflowColumns = async (datasetName) => {
        const path = `/app/datasets/${datasetName}.csv`;
        try {
            const res = await fetch(`${API_BASE}/api/datasets/csv-columns?path=${encodeURIComponent(path)}`);
            const data = await res.json();
            setWorkflowColumns(data.columns || []);
        } catch (_) {
            setWorkflowColumns([]);
        }
    };

    const toggleHistory = async (wfId) => {
        const current = historyState[wfId];
        if (current?.open) {
            setHistoryState(prev => ({ ...prev, [wfId]: { ...prev[wfId], open: false } }));
            return;
        }
        setHistoryState(prev => ({ ...prev, [wfId]: { open: true, loading: true, runs: [] } }));
        try {
            const res = await fetch(`${API_BASE}/api/workflows/${wfId}/history?limit=5`);
            const data = await res.json();
            setHistoryState(prev => ({ ...prev, [wfId]: { open: true, loading: false, runs: data } }));
        } catch (_) {
            setHistoryState(prev => ({ ...prev, [wfId]: { open: true, loading: false, runs: [] } }));
        }
    };

    const fetchCrawlConfigs = async (datasetName) => {
        if (!datasetName) return;
        setLoadingConfigs(true);
        try {
            const res = await fetch(`${API_BASE}/api/crawl/configs/${datasetName}`);
            const data = await res.json();
            setCrawlConfigs(data);
        } catch (_) {
            setCrawlConfigs([]);
        } finally {
            setLoadingConfigs(false);
        }
    };

    const loadCrawlConfig = (jobId) => {
        const found = crawlConfigs.find(c => c.job_id === jobId);
        if (!found) return;
        const config = found.config;
        setStages(prev => ({
            ...prev,
            crawl: {
                ...prev.crawl,
                config: {
                    start_url: config.start_url || '',
                    crawl_type: config.crawl_type || 'flat',
                    container_selector: config.container_selector || '',
                    item_selectors: config.item_selectors || {},
                    link_selector: config.link_selector || '',
                    pagination: config.pagination
                        ? { ...config.pagination, enabled: true }
                        : { enabled: false, method: 'selector', selector: '', max_pages: 3 },
                }
            }
        }));
    };

    const fetchWorkflows = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/workflows`);
            const data = await res.json();
            setWorkflows(data);

            setRunningWorkflows(prev => {
                const next = { ...prev };
                data.forEach(wf => {
                    if (next[wf.id] && wf.last_run_status !== 'running') {
                        delete next[wf.id];
                    }
                });
                return next;
            });
        } catch (_) { }
        finally { setLoading(false); }
    };

    const openBuilder = (workflow = null) => {
        if (workflow) {
            setEditingWorkflow(workflow);
            setWfName(workflow.name);
            setWfDataset(workflow.dataset_name);
            setStages(workflow.stages);
            fetchWorkflowColumns(workflow.dataset_name);
            fetchCrawlConfigs(workflow.dataset_name);  // add this
        } else {
            setEditingWorkflow(null);
            setWfName('');
            setWfDataset('');
            setStages(emptyStages());
            setCrawlConfigs([]);
            setWorkflowColumns([]);
        }
        setExpandedStage('crawl');
        setShowBuilder(true);
    };

    const saveWorkflow = async () => {
        if (!wfName.trim() || !wfDataset.trim()) return;
        setSaving(true);
        try {
            // Strip UI-only enabled flag from pagination before sending
            const payloadStages = JSON.parse(JSON.stringify(stages));
            if (payloadStages.crawl?.config?.pagination) {
                if (payloadStages.crawl.config.pagination.enabled) {
                    delete payloadStages.crawl.config.pagination.enabled;
                } else {
                    payloadStages.crawl.config.pagination = null;
                }
            }
            
            const payload = { name: wfName, dataset_name: wfDataset, stages: payloadStages };
            const url = editingWorkflow
                ? `${API_BASE}/api/workflows/${editingWorkflow.id}`
                : `${API_BASE}/api/workflows`;
            const method = editingWorkflow ? 'PUT' : 'POST';

            await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            setShowBuilder(false);
            fetchWorkflows();
        } catch (_) { }
        finally { setSaving(false); }
    };

    const deleteWorkflow = async (id) => {
        if (!window.confirm('Delete this workflow?')) return;
        await fetch(`${API_BASE}/api/workflows/${id}`, { method: 'DELETE' });
        fetchWorkflows();
    };

    const runWorkflow = async (id) => {
        setRunningWorkflows(prev => ({ ...prev, [id]: { status: 'running', stage: null, message: 'Submitting…' } }));
        try {
            await fetch(`${API_BASE}/api/workflows/${id}/run`, { method: 'POST' });
        } catch (e) {
            setRunningWorkflows(prev => ({ ...prev, [id]: { status: 'failed', error: e.message } }));
        }
    };

    // ── Stage config helpers ────────────────────────────────
    const toggleStage = (stage) => {
        setStages(prev => ({
            ...prev,
            [stage]: { ...prev[stage], enabled: !prev[stage].enabled }
        }));
    };

    const updateStageConfig = (stage, key, value) => {
        setStages(prev => ({
            ...prev,
            [stage]: { ...prev[stage], config: { ...prev[stage].config, [key]: value } }
        }));
    };

    const addProcessingStep = (stepId) => {
        const def = AVAILABLE_STEPS.find(s => s.id === stepId);
        if (!def) return;
        const params = {};
        def.params.forEach(p => { params[p.key] = p.default; });
        const newStep = { step: def.id, label: def.label, params };
        setStages(prev => ({
            ...prev,
            processing: {
                ...prev.processing,
                config: { steps: [...prev.processing.config.steps, newStep] }
            }
        }));
    };

    const removeProcessingStep = (idx) => {
        setStages(prev => ({
            ...prev,
            processing: {
                ...prev.processing,
                config: { steps: prev.processing.config.steps.filter((_, i) => i !== idx) }
            }
        }));
    };

    const updateProcessingStepParam = (stepIdx, key, value) => {
        setStages(prev => {
            const steps = prev.processing.config.steps.map((s, i) =>
                i === stepIdx ? { ...s, params: { ...s.params, [key]: value } } : s
            );
            return { ...prev, processing: { ...prev.processing, config: { steps } } };
        });
    };

    // ── Render ──────────────────────────────────────────────
    return (
        <div className="page-container">
            <div className="page-header flex-between">
                <div>
                    <h1 className="page-title">Workflows</h1>
                    <p className="page-description">Saved end-to-end pipelines — crawl, process, and train in one click</p>
                </div>
                <button className="btn btn-primary" onClick={() => openBuilder()}>
                    <Plus size={14} /> New Workflow
                </button>
            </div>

            {/* ── Workflow Builder ── */}
            {showBuilder && (
                <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
                    <div className="card-header">
                        <span className="card-title">
                            {editingWorkflow ? `Edit: ${editingWorkflow.name}` : 'New Workflow'}
                        </span>
                        <button className="btn btn-secondary btn-sm"
                            onClick={() => setShowBuilder(false)}>
                            Cancel
                        </button>
                    </div>
                    <div className="card-body">
                        {/* Name + Dataset */}
                        <div className="grid-2" style={{ marginBottom: 'var(--space-md)' }}>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Workflow Name</label>
                                <input className="form-input" value={wfName}
                                    onChange={e => setWfName(e.target.value)}
                                    placeholder="e.g. Books Full Pipeline" />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Dataset Name</label>
                                <input className="form-input" value={wfDataset}
                                    onChange={e => {
                                        setWfDataset(e.target.value);
                                        setWorkflowColumns([]);
                                        setCrawlConfigs([]);
                                        if (e.target.value) {
                                            fetchWorkflowColumns(e.target.value);
                                            fetchCrawlConfigs(e.target.value);
                                        }
                                    }}
                                    placeholder="e.g. books_test" />
                            </div>
                        </div>

                        {/* Stage accordions */}
                        {['crawl', 'processing', 'ml'].map(stageName => (
                            <div key={stageName} className="card"
                                style={{ marginBottom: 'var(--space-sm)' }}>
                                {/* Stage header */}
                                <div className="card-header" style={{ cursor: 'pointer' }}
                                    onClick={() => setExpandedStage(
                                        expandedStage === stageName ? null : stageName
                                    )}>
                                    <div className="flex-row">
                                        <input type="checkbox"
                                            checked={stages[stageName].enabled}
                                            onChange={() => toggleStage(stageName)}
                                            onClick={e => e.stopPropagation()}
                                            style={{ accentColor: '#111' }}
                                        />
                                        <span className="card-title" style={{ textTransform: 'capitalize' }}>
                                            {stageName === 'ml' ? 'ML Training' : stageName}
                                        </span>
                                        {!stages[stageName].enabled && (
                                            <span className="badge badge-neutral">disabled</span>
                                        )}
                                    </div>
                                    {expandedStage === stageName
                                        ? <ChevronUp size={14} />
                                        : <ChevronDown size={14} />}
                                </div>

                                {/* Stage body */}
                                {expandedStage === stageName && stages[stageName].enabled && (
                                    <div className="card-body">
                                        {/* ── Crawl config ── */}
                                        {stageName === 'crawl' && (
                                            <div>
                                                {/* Config loader */}
                                                {crawlConfigs.length > 0 && (
                                                    <div className="form-group">
                                                        <label className="form-label">Load from previous crawl</label>
                                                        <select
                                                            className="form-select"
                                                            defaultValue=""
                                                            onChange={e => { if (e.target.value) loadCrawlConfig(e.target.value); }}
                                                        >
                                                            <option value="" disabled>Select a previous run…</option>
                                                            {crawlConfigs.map(c => (
                                                                <option key={c.job_id} value={c.job_id}>
                                                                    {new Date(c.created_at).toLocaleString()} — {c.job_id.substring(0, 8)}…
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                )}
                                                {loadingConfigs && (
                                                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 'var(--space-sm)' }}>
                                                        <span className="spinner" /> Loading previous configs…
                                                    </div>
                                                )}
                                                <div className="form-group">
                                                    <label className="form-label">Start URL</label>
                                                    <input className="form-input"
                                                        value={stages.crawl.config.start_url}
                                                        onChange={e => updateStageConfig('crawl', 'start_url', e.target.value)}
                                                        placeholder="https://example.com" />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">Crawl Type</label>
                                                    <select className="form-select"
                                                        value={stages.crawl.config.crawl_type}
                                                        onChange={e => updateStageConfig('crawl', 'crawl_type', e.target.value)}>
                                                        <option value="flat">Flat</option>
                                                        <option value="list-detail">List-Detail</option>
                                                    </select>
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">Container Selector</label>
                                                    <input className="form-input mono"
                                                        value={stages.crawl.config.container_selector}
                                                        onChange={e => updateStageConfig('crawl', 'container_selector', e.target.value)}
                                                        placeholder="e.g. article.product_pod" />
                                                </div>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <label className="form-label">
                                                        Item Selectors (JSON)
                                                    </label>
                                                    <textarea className="form-input mono"
                                                        rows={4}
                                                        value={JSON.stringify(stages.crawl.config.item_selectors, null, 2)}
                                                        onChange={e => {
                                                            try {
                                                                updateStageConfig('crawl', 'item_selectors', JSON.parse(e.target.value));
                                                            } catch (_) { }
                                                        }}
                                                        placeholder='{"title": "h3 a::attr(title)", "price": ".price_color::text"}'
                                                        style={{ resize: 'vertical' }}
                                                    />
                                                    <div className="form-hint">Paste your selectors as JSON</div>
                                                </div>

                                                {/* ── Pagination ── */}
                                                <div style={{ marginTop: 'var(--space-md)', borderTop: '1px solid var(--border-light)', paddingTop: 'var(--space-md)' }}>
                                                    <div className="checkbox-group" style={{ marginBottom: 'var(--space-sm)' }}>
                                                        <input
                                                            type="checkbox"
                                                            id="pagination-toggle"
                                                            checked={!!stages.crawl.config.pagination?.enabled}
                                                            onChange={e => updateStageConfig('crawl', 'pagination', {
                                                                ...stages.crawl.config.pagination,
                                                                enabled: e.target.checked
                                                            })}
                                                        />
                                                        <label htmlFor="pagination-toggle" style={{ fontWeight: 600, fontSize: 13 }}>
                                                            Enable Pagination
                                                        </label>
                                                    </div>

                                                    {stages.crawl.config.pagination?.enabled && (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                                                            <div className="grid-2">
                                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                                    <label className="form-label">Method</label>
                                                                    <select
                                                                        className="form-select"
                                                                        value={stages.crawl.config.pagination?.method || 'selector'}
                                                                        onChange={e => updateStageConfig('crawl', 'pagination', {
                                                                            ...stages.crawl.config.pagination,
                                                                            method: e.target.value
                                                                        })}
                                                                    >
                                                                        <option value="selector">Selector (next-page link)</option>
                                                                        <option value="numeric">Numeric (?page=N)</option>
                                                                    </select>
                                                                </div>
                                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                                    <label className="form-label">Max Pages</label>
                                                                    <input
                                                                        className="form-input"
                                                                        type="number"
                                                                        min={1}
                                                                        max={50}
                                                                        value={stages.crawl.config.pagination?.max_pages || 3}
                                                                        onChange={e => updateStageConfig('crawl', 'pagination', {
                                                                            ...stages.crawl.config.pagination,
                                                                            max_pages: parseInt(e.target.value) || 1
                                                                        })}
                                                                    />
                                                                </div>
                                                            </div>

                                                            {stages.crawl.config.pagination?.method === 'selector' && (
                                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                                    <label className="form-label">Next-Page Selector</label>
                                                                    <input
                                                                        className="form-input mono"
                                                                        value={stages.crawl.config.pagination?.selector || ''}
                                                                        onChange={e => updateStageConfig('crawl', 'pagination', {
                                                                            ...stages.crawl.config.pagination,
                                                                            selector: e.target.value
                                                                        })}
                                                                        placeholder="e.g. li.next a"
                                                                    />
                                                                    <div className="form-hint">CSS selector for the link to the next page</div>
                                                                </div>
                                                            )}

                                                            {stages.crawl.config.pagination?.method === 'numeric' && (
                                                                <div className="form-hint">
                                                                    Appends <span className="mono">?page=N</span> to the start URL automatically
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* ── Processing config ── */}
                                        {stageName === 'processing' && (
                                            <div>
                                                {stages.processing.config.steps.length === 0 ? (
                                                    <div className="empty-state" style={{ padding: 'var(--space-md)' }}>
                                                        <div className="empty-state-text">No steps added</div>
                                                    </div>
                                                ) : (
                                                    stages.processing.config.steps.map((step, idx) => {
                                                        const def = AVAILABLE_STEPS.find(s => s.id === step.step);
                                                        return (
                                                            <div key={idx} className="pipeline-step">
                                                                <div className="pipeline-step-number">{idx + 1}</div>
                                                                <div className="pipeline-step-content">
                                                                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                                                                        {step.label}
                                                                    </div>
                                                                    {def && def.params.map(p => (
                                                                        <div key={p.key} className="form-group" style={{ marginBottom: 6 }}>
                                                                            <label className="form-label" style={{ fontSize: 10 }}>{p.label}</label>
                                                                            {p.type === 'select' ? (
                                                                                <select className="form-select"
                                                                                    value={step.params[p.key]}
                                                                                    onChange={e => updateProcessingStepParam(idx, p.key, e.target.value)}
                                                                                    style={{ padding: '4px 8px', fontSize: 12 }}>
                                                                                    {p.options.map(o => <option key={o} value={o}>{o}</option>)}
                                                                                </select>
                                                                            ) : (
                                                                                <input className="form-input"
                                                                                    value={step.params[p.key]}
                                                                                    onChange={e => updateProcessingStepParam(idx, p.key, e.target.value)}
                                                                                    style={{ padding: '4px 8px', fontSize: 12 }} />
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                                <button className="btn btn-secondary btn-sm"
                                                                    onClick={() => removeProcessingStep(idx)}>
                                                                    <Trash2 size={12} />
                                                                </button>
                                                            </div>
                                                        );
                                                    })
                                                )}
                                                <select className="form-select"
                                                    value=""
                                                    onChange={e => { if (e.target.value) addProcessingStep(e.target.value); }}
                                                    style={{ marginTop: 'var(--space-sm)', color: 'var(--text-tertiary)' }}>
                                                    <option value="" disabled>+ Add processing step…</option>
                                                    {AVAILABLE_STEPS.map(s => (
                                                        <option key={s.id} value={s.id}>{s.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {/* ── ML config ── */}
                                        {stageName === 'ml' && (
                                            <div>
                                                <div className="form-group">
                                                    <label className="form-label">Target Column</label>
                                                    {workflowColumns.length > 0 ? (
                                                        <select
                                                            className="form-select"
                                                            value={stages.ml.config.target_column}
                                                            onChange={e => updateStageConfig('ml', 'target_column', e.target.value)}
                                                        >
                                                            <option value="" disabled>Select target column…</option>
                                                            {workflowColumns.map(col => (
                                                                <option key={col} value={col}>{col}</option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <input
                                                            className="form-input"
                                                            value={stages.ml.config.target_column}
                                                            onChange={e => updateStageConfig('ml', 'target_column', e.target.value)}
                                                            placeholder="Save dataset first, then columns will appear"
                                                        />
                                                    )}
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">Model Type</label>
                                                    <select className="form-select"
                                                        value={stages.ml.config.model_type}
                                                        onChange={e => updateStageConfig('ml', 'model_type', e.target.value)}>
                                                        {ML_MODELS.map(m => (
                                                            <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="checkbox-group" style={{ marginBottom: 0 }}>
                                                    <input type="checkbox"
                                                        checked={stages.ml.config.auto_tune}
                                                        onChange={e => updateStageConfig('ml', 'auto_tune', e.target.checked)} />
                                                    <label>Auto-tune hyperparameters</label>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}

                        <button className="btn btn-primary"
                            onClick={saveWorkflow}
                            disabled={saving || !wfName.trim() || !wfDataset.trim()}
                            style={{ marginTop: 'var(--space-md)' }}>
                            {saving ? <><span className="spinner" /> Saving…</> : 'Save Workflow'}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Workflow List ── */}
            {loading ? (
                <div className="card">
                    <div className="card-body empty-state">
                        <span className="spinner" style={{ width: 24, height: 24 }} />
                    </div>
                </div>
            ) : workflows.length === 0 ? (
                <div className="card">
                    <div className="card-body empty-state">
                        <Activity />
                        <div className="empty-state-title">No workflows yet</div>
                        <div className="empty-state-text">
                            Create a workflow to automate your end-to-end pipeline
                        </div>
                    </div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    {workflows.map(wf => {
                        const running = runningWorkflows[wf.id];
                        const isRunning = running?.status === 'running';

                        return (
                            <div key={wf.id} className="card">
                                <div className="card-header">
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: 14 }}>{wf.name}</div>
                                        <div style={{
                                            fontSize: 11, color: 'var(--text-tertiary)',
                                            marginTop: 2, fontFamily: 'monospace'
                                        }}>
                                            {wf.dataset_name}
                                        </div>
                                    </div>
                                    <div className="flex-row">
                                        <StatusBadge status={running?.status || wf.last_run_status} />
                                        <button className="btn btn-secondary btn-sm"
                                            onClick={() => openBuilder(wf)}
                                            disabled={isRunning}>
                                            <Edit2 size={12} />
                                        </button>
                                        <button className="btn btn-secondary btn-sm"
                                            onClick={() => deleteWorkflow(wf.id)}
                                            disabled={isRunning}>
                                            <Trash2 size={12} />
                                        </button>
                                        <button
                                            className={`btn btn-sm ${isRunning ? 'btn-secondary' : 'btn-primary'}`}
                                            onClick={() => runWorkflow(wf.id)}
                                            disabled={isRunning}>
                                            {isRunning
                                                ? <><span className="spinner" /> Running…</>
                                                : <><Play size={12} /> Run</>}
                                        </button>
                                    </div>
                                </div>
                                <div className="card-body" style={{ paddingTop: 'var(--space-sm)' }}>
                                    {/* Stage chips */}
                                    <div className="flex-row" style={{ marginBottom: 'var(--space-sm)' }}>
                                        <StageChip label="Crawl" enabled={wf.stages?.crawl?.enabled} />
                                        <StageChip label="Processing" enabled={wf.stages?.processing?.enabled} />
                                        <StageChip label="ML Training" enabled={wf.stages?.ml?.enabled} />
                                    </div>

                                    {/* Live progress */}
                                    {running && (
                                        <div className={`log-entry ${running.status === 'failed' ? 'error' :
                                            running.status === 'completed' ? 'success' : 'info'
                                            }`} style={{ marginTop: 'var(--space-xs)' }}>
                                            {running.stage && (
                                                <span className="badge badge-neutral"
                                                    style={{ marginRight: 6, fontSize: 10 }}>
                                                    {running.stage}
                                                </span>
                                            )}
                                            <span style={{ fontSize: 12 }}>
                                                {running.error || running.message}
                                            </span>
                                        </div>
                                    )}

                                    {/* ── Run History Panel ── */}
                                    <div style={{ marginTop: 'var(--space-sm)', borderTop: '1px solid var(--border-light)', paddingTop: 'var(--space-sm)' }}>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => toggleHistory(wf.id)}
                                            style={{ width: '100%', justifyContent: 'space-between', display: 'flex', alignItems: 'center' }}
                                        >
                                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <History size={12} />
                                                Run History
                                            </span>
                                            {historyState[wf.id]?.open
                                                ? <ChevronUp size={12} />
                                                : <ChevronDown size={12} />}
                                        </button>

                                        {historyState[wf.id]?.open && (
                                            <div style={{ marginTop: 'var(--space-sm)' }}>
                                                {historyState[wf.id]?.loading ? (
                                                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
                                                        <span className="spinner" /> Loading…
                                                    </div>
                                                ) : historyState[wf.id]?.runs?.length === 0 ? (
                                                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>
                                                        No runs recorded yet.
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                        {historyState[wf.id].runs.map((run) => {
                                                            const stageResults = run.stage_results || {};
                                                            const statusColor = run.status === 'completed'
                                                                ? 'var(--color-success)'
                                                                : run.status === 'failed'
                                                                    ? 'var(--color-error)'
                                                                    : 'var(--color-warning)';

                                                            return (
                                                                <div key={run.run_id} style={{
                                                                    background: 'var(--bg-secondary)',
                                                                    borderRadius: 'var(--radius-md)',
                                                                    padding: '8px 10px',
                                                                    fontSize: 12,
                                                                }}>
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                                                        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                                                                            {run.started_at ? new Date(run.started_at).toLocaleString() : '—'}
                                                                            {run.duration && <span style={{ marginLeft: 8 }}>({run.duration})</span>}
                                                                        </span>
                                                                        <span style={{ fontWeight: 600, color: statusColor, fontSize: 11, textTransform: 'capitalize' }}>
                                                                            {run.status}
                                                                        </span>
                                                                    </div>
                                                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                                        {['crawl', 'processing', 'ml'].map(stage => {
                                                                            const s = stageResults[stage];
                                                                            if (!s) return null;
                                                                            const ok = s.status === 'completed';
                                                                            return (
                                                                                <span
                                                                                    key={stage}
                                                                                    title={s.message || ''}
                                                                                    className={`badge ${ok ? 'badge-success' : 'badge-error'}`}
                                                                                    style={{ fontSize: 10 }}
                                                                                >
                                                                                    {ok ? <CheckCircle size={9} style={{ marginRight: 3 }} /> : <XCircle size={9} style={{ marginRight: 3 }} />}
                                                                                    {stage === 'ml' ? 'ML' : stage.charAt(0).toUpperCase() + stage.slice(1)}
                                                                                </span>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}