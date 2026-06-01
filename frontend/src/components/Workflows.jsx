import React, { useState, useEffect } from 'react';
import {
    Play, Plus, Trash2, Edit2, CheckCircle, XCircle, ChevronDown, ChevronUp, Activity, History, Sparkles, Info
} from 'lucide-react';
import WorkflowDetail from './WorkflowDetail';

const OwnershipBadge = ({ ownerUsername }) => {
  if (!ownerUsername) return null;
  // If we don't have is_admin info here, we assume 'admin' username is shared
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

// Compact live stepper shown inside each workflow card while running
function MiniPipelineStepper({ running, workflowStages }) {
    const STAGES = ['crawl', 'processing', 'ml'];
    const LABELS = { crawl: 'Crawl', processing: 'Process', ml: 'ML' };
    const enabledStages = STAGES.filter(s => workflowStages?.[s]?.enabled);
    const liveMap = running?.stages || {};

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            marginTop: 'var(--space-xs)', flexWrap: 'wrap',
        }}>
            {enabledStages.map((stage, i) => {
                const live     = liveMap[stage];
                const isCurrent = running?.stage === stage && running?.status === 'running';
                const isDone    = live?.status === 'completed';
                const isFailed  = live?.status === 'failed';
                const isActive  = isCurrent || live?.status === 'running';

                return (
                    <React.Fragment key={stage}>
                        {i > 0 && (
                            <div style={{
                                width: 14, height: 1,
                                background: isDone ? 'var(--color-success)' : 'var(--border-light)',
                                flexShrink: 0,
                            }} />
                        )}
                        <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                            transition: 'all 0.3s',
                            background: isDone
                                ? 'rgba(22,163,74,0.12)'
                                : isFailed
                                    ? 'rgba(220,38,38,0.12)'
                                    : isActive
                                        ? 'rgba(79,70,229,0.12)'
                                        : 'var(--bg-secondary)',
                            color: isDone
                                ? 'var(--color-success)'
                                : isFailed
                                    ? 'var(--color-error)'
                                    : isActive
                                        ? 'var(--color-primary)'
                                        : 'var(--text-muted)',
                            border: `1px solid ${
                                isDone   ? 'rgba(22,163,74,0.3)'
                                : isFailed  ? 'rgba(220,38,38,0.3)'
                                : isActive  ? 'rgba(79,70,229,0.3)'
                                : 'var(--border-light)'
                            }`,
                        }}>
                            {isActive  && <span className="spinner" style={{ width: 8, height: 8 }} />}
                            {isDone    && <CheckCircle size={8} />}
                            {isFailed  && <XCircle    size={8} />}
                            {LABELS[stage]}
                        </span>
                    </React.Fragment>
                );
            })}
            {running?.message && (
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                    {running.message.length > 50
                        ? running.message.slice(0, 50) + '…'
                        : running.message}
                </span>
            )}
        </div>
    );
}

export default function Workflows({ wsEvents = [] }) {
    const [workflows, setWorkflows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showBuilder, setShowBuilder] = useState(false);
    const [editingWorkflow, setEditingWorkflow] = useState(null);

    const [wfName, setWfName] = useState('');
    const [wfDataset, setWfDataset] = useState('');
    const [stages, setStages] = useState(emptyStages());
    const [expandedStage, setExpandedStage] = useState('crawl');
    const [saving, setSaving] = useState(false);

    // Past-run config loaders (unified — used inside the builder for all stages)
    const [crawlConfigs, setCrawlConfigs] = useState([]);
    const [procConfigs, setProcConfigs] = useState([]);
    const [trainConfigs, setTrainConfigs] = useState([]);
    const [loadingConfigs, setLoadingConfigs] = useState(false);
    const [loadingProcConfigs, setLoadingProcConfigs] = useState(false);
    const [loadingTrainConfigs, setLoadingTrainConfigs] = useState(false);
    // Which stages had a past-run config loaded (for visual confirmation)
    const [loadedStages, setLoadedStages] = useState({});

    const [availableDatasets, setAvailableDatasets] = useState([]);
    const [csvDatasets, setCsvDatasets] = useState([]);

    // Detail view — which workflow is "drilled in"
    const [selectedWorkflow, setSelectedWorkflow] = useState(null);

    // Running jobs — derived from wsEvents prop
    const [runningWorkflows, setRunningWorkflows] = useState({});
    // Run history — { [wf.id]: { open: bool, loading: bool, runs: [] } }
    const [historyState, setHistoryState] = useState({});

    useEffect(() => {
        fetchWorkflows();
        
        const token = localStorage.getItem('auth_token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        
        // Fetch all datasets for dropdown hints
        fetch(`${API_BASE}/api/datasets/list`, { headers })
            .then(res => res.json())
            .then(data => {
                const names = data.map(d => d.source_dataset || d.dataset_name).filter(Boolean);
                // Also fetch csv-list as backup combinations
                fetch(`${API_BASE}/api/datasets/csv-list`, { headers })
                    .then(resCSV => resCSV.json())
                    .then(dataCSV => {
                        setCsvDatasets(dataCSV);
                        const csvNames = dataCSV.map(d => d.name);
                        setAvailableDatasets(Array.from(new Set([...names, ...csvNames])));
                    })
                    .catch(() => setAvailableDatasets(names));
            })
            .catch(() => {});
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
                ...prev[wfId],
                status:  latest.status,
                stage:   latest.stage,
                message: latest.message,
                error:   latest.error,
                // Accumulate per-stage: keep completed stages visible as new ones start
                stages: {
                    ...(prev[wfId]?.stages || {}),
                    ...(latest.stage ? {
                        [latest.stage]: { status: latest.status, message: latest.message }
                    } : {}),
                },
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

    const fetchWorkflowColumns = async (datasetName) => {
        if (!datasetName) return;
        const token = localStorage.getItem('auth_token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        let path = '';
        const found = csvDatasets.find(d => d.name === datasetName);
        if (found) {
            path = found.path;
        } else {
            // fallback: refetch the list to see if it was saved recently
            try {
                const res = await fetch(`${API_BASE}/api/datasets/csv-list`, { headers });
                const list = await res.json();
                setCsvDatasets(list);
                const match = list.find(d => d.name === datasetName);
                if (match) {
                    path = match.path;
                }
            } catch (_) {}
        }

        if (!path) {
            // fallback path if still not found
            path = `/app/datasets/${datasetName}.csv`;
        }

        try {
            const res = await fetch(`${API_BASE}/api/datasets/csv-columns?path=${encodeURIComponent(path)}`, { headers });
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
            const token = localStorage.getItem('auth_token');
            const headers = token ? { Authorization: `Bearer ${token}` } : {};
            const res = await fetch(`${API_BASE}/api/workflows/${wfId}/history?limit=5`, { headers });
            const data = await res.json();
            setHistoryState(prev => ({ ...prev, [wfId]: { open: true, loading: false, runs: data } }));
        } catch (_) {
            setHistoryState(prev => ({ ...prev, [wfId]: { open: true, loading: false, runs: [] } }));
        }
    };

    const fetchAllStageConfigs = async (datasetName) => {
        if (!datasetName) return;
        // Fetch all three stage configs in parallel
        setLoadingConfigs(true);
        setLoadingProcConfigs(true);
        setLoadingTrainConfigs(true);
        try {
            const token = localStorage.getItem('auth_token');
            const headers = token ? { Authorization: `Bearer ${token}` } : {};
            const [crawlRes, procRes, trainRes] = await Promise.allSettled([
                fetch(`${API_BASE}/api/crawl/configs/${datasetName}`, { headers }).then(r => r.json()),
                fetch(`${API_BASE}/api/workflows/configs/process/${datasetName}`, { headers }).then(r => r.json()),
                fetch(`${API_BASE}/api/ml-training/configs/${datasetName}`, { headers }).then(r => r.json()),
            ]);
            setCrawlConfigs(crawlRes.status === 'fulfilled' && Array.isArray(crawlRes.value) ? crawlRes.value : []);
            setProcConfigs(procRes.status === 'fulfilled' && Array.isArray(procRes.value) ? procRes.value : []);
            setTrainConfigs(trainRes.status === 'fulfilled' && Array.isArray(trainRes.value) ? trainRes.value : []);
        } catch (_) {
            setCrawlConfigs([]);
            setProcConfigs([]);
            setTrainConfigs([]);
        } finally {
            setLoadingConfigs(false);
            setLoadingProcConfigs(false);
            setLoadingTrainConfigs(false);
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
        setLoadedStages(prev => ({ ...prev, crawl: new Date(found.created_at).toLocaleString() }));
    };

    const loadProcConfig = (jobId) => {
        const found = Array.isArray(procConfigs) ? procConfigs.find(c => c.job_id === jobId) : null;
        if (!found) return;
        setStages(prev => ({
            ...prev,
            processing: { ...prev.processing, config: { steps: found.config || [] } }
        }));
        setLoadedStages(prev => ({ ...prev, processing: new Date(found.created_at).toLocaleString() }));
    };

    const loadTrainConfig = (jobId) => {
        const found = Array.isArray(trainConfigs) ? trainConfigs.find(c => c.job_id === jobId) : null;
        if (!found) return;
        const config = found.config || {};
        setStages(prev => ({
            ...prev,
            ml: {
                ...prev.ml,
                config: {
                    model_type: config.model_type || 'random_forest',
                    target_column: config.target_column || '',
                    auto_tune: config.auto_tune !== undefined ? !!config.auto_tune : true,
                    params: config.params || {},
                }
            }
        }));
        setLoadedStages(prev => ({ ...prev, ml: new Date(found.created_at).toLocaleString() }));
    };

    const fetchWorkflows = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('auth_token');
            const headers = token ? { Authorization: `Bearer ${token}` } : {};
            const res = await fetch(`${API_BASE}/api/workflows`, { headers });
            const data = await res.json();
            setWorkflows(data);

            // Keep the detail view in sync if a workflow is selected
            setSelectedWorkflow(prev => {
                if (!prev) return null;
                return data.find(w => w.id === prev.id) || null;
            });

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
        setSelectedWorkflow(null); // close detail view when editing
        setLoadedStages({});
        if (workflow) {
            setEditingWorkflow(workflow);
            setWfName(workflow.name);
            setWfDataset(workflow.dataset_name);
            setStages(workflow.stages);
            fetchWorkflowColumns(workflow.dataset_name);
            fetchAllStageConfigs(workflow.dataset_name);
        } else {
            setEditingWorkflow(null);
            setWfName('');
            setWfDataset('');
            setStages(emptyStages());
            setCrawlConfigs([]);
            setProcConfigs([]);
            setTrainConfigs([]);
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

            const token = localStorage.getItem('auth_token');
            const headers = {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            };

            await fetch(url, {
                method,
                headers,
                body: JSON.stringify(payload),
            });
            setShowBuilder(false);
            fetchWorkflows();
        } catch (_) { }
        finally { setSaving(false); }
    };

    // (stitchWorkflow removed — stitching is now done inside the builder directly)

    const deleteWorkflow = async (id) => {
        if (!window.confirm('Delete this workflow?')) return;
        const token = localStorage.getItem('auth_token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        await fetch(`${API_BASE}/api/workflows/${id}`, { method: 'DELETE', headers });
        if (selectedWorkflow?.id === id) setSelectedWorkflow(null);
        fetchWorkflows();
    };

    const runWorkflow = async (id) => {
        setRunningWorkflows(prev => ({ ...prev, [id]: { status: 'running', stage: null, message: 'Submitting…' } }));
        try {
            const token = localStorage.getItem('auth_token');
            const headers = token ? { Authorization: `Bearer ${token}` } : {};
            await fetch(`${API_BASE}/api/workflows/${id}/run`, { method: 'POST', headers });
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
    // Detail view — renders instead of the list
    if (selectedWorkflow) {
        return (
            <WorkflowDetail
                workflow={selectedWorkflow}
                onBack={() => setSelectedWorkflow(null)}
                onEdit={openBuilder}
                onDelete={deleteWorkflow}
                onRun={runWorkflow}
                isRunning={!!runningWorkflows[selectedWorkflow.id]?.status && runningWorkflows[selectedWorkflow.id]?.status === 'running'}
                runningInfo={runningWorkflows[selectedWorkflow.id]}
                wsEvents={wsEvents}
            />
        );
    }

    return (
        <div className="page-container">
            <div className="page-header flex-between">
                <div>
                    <h1 className="page-title">Workflows</h1>
                    <p className="page-description">Saved end-to-end pipelines — crawl, process, and train in one click</p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-primary" onClick={() => openBuilder()}>
                        <Plus size={14} /> New Workflow
                    </button>
                </div>
            </div>

            {/* -- Datalist for datasets -- */}
            <datalist id="available-datasets">
                {availableDatasets.map(d => <option key={d} value={d} />)}
            </datalist>

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
                        {/* Hint banner: past-run configs available */}
                        <div style={{
                            marginBottom: 'var(--space-md)',
                            padding: '10px 14px',
                            borderRadius: 'var(--radius-sm)',
                            background: 'rgba(79,70,229,0.06)',
                            border: '1px solid rgba(79,70,229,0.18)',
                            display: 'flex', alignItems: 'flex-start', gap: 8,
                            fontSize: 12, color: 'var(--text-secondary)'
                        }}>
                            <Sparkles size={14} style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: 1 }} />
                            <span>
                                <strong style={{ color: 'var(--color-primary)' }}>Flexible Builder</strong> — each stage can be
                                pre-filled from a previous run or configured from scratch. Mix and match freely!
                            </span>
                        </div>

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
                                    list="available-datasets"
                                    onChange={e => {
                                        setWfDataset(e.target.value);
                                        setWorkflowColumns([]);
                                        setCrawlConfigs([]);
                                        setProcConfigs([]);
                                        setTrainConfigs([]);
                                        setLoadedStages({});
                                        if (e.target.value) {
                                            fetchWorkflowColumns(e.target.value);
                                            fetchAllStageConfigs(e.target.value);
                                        }
                                    }}
                                    placeholder="Select or type new dataset..." />
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
                                                {/* Loaded confirmation banner */}
                                                {loadedStages.crawl && (
                                                    <div style={{
                                                        marginBottom: 'var(--space-sm)',
                                                        padding: '7px 12px',
                                                        borderRadius: 'var(--radius-sm)',
                                                        background: 'rgba(22,163,74,0.08)',
                                                        border: '1px solid rgba(22,163,74,0.25)',
                                                        display: 'flex', alignItems: 'center', gap: 6,
                                                        fontSize: 11, color: 'var(--color-success)'
                                                    }}>
                                                        <CheckCircle size={12} />
                                                        Loaded from past run ({loadedStages.crawl}). Tweak any field below.
                                                    </div>
                                                )}
                                                {/* Config loader */}
                                                {(crawlConfigs.length > 0 || loadingConfigs) && (
                                                    <div className="form-group">
                                                        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                                            <History size={11} /> Load from previous crawl
                                                            {loadingConfigs && <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 10 }}>Loading…</span>}
                                                        </label>
                                                        <select
                                                            className="form-select"
                                                            defaultValue=""
                                                            onChange={e => { if (e.target.value) loadCrawlConfig(e.target.value); }}
                                                            style={{ padding: '4px 8px', fontSize: 12 }}
                                                        >
                                                            <option value="" disabled>Select a previous run to pre-fill…</option>
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
                                                        onChange={e => updateStageConfig('crawl', 'crawl_type', e.target.value)}
                                                        style={{ padding: '4px 8px', fontSize: 12 }}>
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
                                                                        style={{ padding: '4px 8px', fontSize: 12 }}
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
                                                                        max={1000}
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
                                                {/* Loaded confirmation banner */}
                                                {loadedStages.processing && (
                                                    <div style={{
                                                        marginBottom: 'var(--space-sm)',
                                                        padding: '7px 12px',
                                                        borderRadius: 'var(--radius-sm)',
                                                        background: 'rgba(22,163,74,0.08)',
                                                        border: '1px solid rgba(22,163,74,0.25)',
                                                        display: 'flex', alignItems: 'center', gap: 6,
                                                        fontSize: 11, color: 'var(--color-success)'
                                                    }}>
                                                        <CheckCircle size={12} />
                                                        Loaded from past run ({loadedStages.processing}). Add, remove or reorder steps below.
                                                    </div>
                                                )}
                                                {/* Config loader for Processing */}
                                                {(Array.isArray(procConfigs) && procConfigs.length > 0) || loadingProcConfigs ? (
                                                    <div className="form-group">
                                                        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                                            <History size={11} /> Load from previous run
                                                            {loadingProcConfigs && <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 10 }}>Loading…</span>}
                                                        </label>
                                                        <select
                                                            className="form-select"
                                                            defaultValue=""
                                                            onChange={e => { if (e.target.value) loadProcConfig(e.target.value); }}
                                                            style={{ padding: '4px 8px', fontSize: 12, marginBottom: 'var(--space-sm)' }}
                                                        >
                                                            <option value="" disabled>Select a previous run to pre-fill steps…</option>
                                                            {procConfigs.map(c => (
                                                                <option key={c.job_id} value={c.job_id}>
                                                                    {new Date(c.created_at).toLocaleString()} — {c.config?.length || 0} steps
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                ) : wfDataset ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', marginBottom: 'var(--space-sm)', padding: '6px 10px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)' }}>
                                                        <Info size={11} /> No previous processing runs found for this dataset — configure steps manually below.
                                                    </div>
                                                ) : null}
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
                                                {/* Loaded confirmation banner */}
                                                {loadedStages.ml && (
                                                    <div style={{
                                                        marginBottom: 'var(--space-sm)',
                                                        padding: '7px 12px',
                                                        borderRadius: 'var(--radius-sm)',
                                                        background: 'rgba(22,163,74,0.08)',
                                                        border: '1px solid rgba(22,163,74,0.25)',
                                                        display: 'flex', alignItems: 'center', gap: 6,
                                                        fontSize: 11, color: 'var(--color-success)'
                                                    }}>
                                                        <CheckCircle size={12} />
                                                        Loaded from past run ({loadedStages.ml}). Adjust model or target column below.
                                                    </div>
                                                )}
                                                {/* Config loader for ML */}
                                                {(Array.isArray(trainConfigs) && trainConfigs.length > 0) || loadingTrainConfigs ? (
                                                    <div className="form-group">
                                                        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                                            <History size={11} /> Load from previous run
                                                            {loadingTrainConfigs && <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 10 }}>Loading…</span>}
                                                        </label>
                                                        <select
                                                            className="form-select"
                                                            defaultValue=""
                                                            onChange={e => { if (e.target.value) loadTrainConfig(e.target.value); }}
                                                            style={{ padding: '4px 8px', fontSize: 12, marginBottom: 'var(--space-sm)' }}
                                                        >
                                                            <option value="" disabled>Select a previous run to pre-fill…</option>
                                                            {trainConfigs.map(c => (
                                                                <option key={c.job_id} value={c.job_id}>
                                                                    {new Date(c.created_at).toLocaleString()} — {c.config?.model_type?.replace(/_/g,' ')} → {c.config?.target_column}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                ) : wfDataset ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', marginBottom: 'var(--space-sm)', padding: '6px 10px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-light)' }}>
                                                        <Info size={11} /> No previous ML training runs found for this dataset — configure manually below.
                                                    </div>
                                                ) : null}
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
                                        <div
                                            style={{ fontWeight: 600, fontSize: 14, cursor: 'pointer', textDecoration: 'none' }}
                                            onClick={() => setSelectedWorkflow(wf)}
                                            title="View details"
                                        >
                                            {wf.name}
                                            <OwnershipBadge ownerUsername={wf.owner_username} />
                                            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: 6 }}>↗</span>
                                        </div>
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

                                    {/* Live pipeline stepper */}
                                    {running && (
                                        <MiniPipelineStepper
                                            running={running}
                                            workflowStages={wf.stages}
                                        />
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