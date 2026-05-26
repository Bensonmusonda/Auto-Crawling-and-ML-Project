import React, { useState, useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Cell
} from 'recharts';
import {
    Play, Database, ArrowRight, X, Sparkles, Loader
} from 'lucide-react';
import CsvDatasetPicker from './CsvDatasetPicker';
import PredictionTester from './PredictionTester';
import ModelApiDocs from './ModelApiDocs';

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

const METRIC_COLORS = {
    accuracy: '#111111',
    f1_score: '#2563eb',
    precision: '#16a34a',
    recall: '#d97706',
    r2_score: '#111111',
    mse: '#dc2626',
    mae: '#d97706',
    rmse: '#555555',
};


function getPrimaryMetric(model) {
    if (!model?.metrics) return { label: '—', value: null };
    const m = model.metrics;
    if (model.task_type === 'regression') {
        if (m.r2_score != null) return { label: 'R²', value: m.r2_score.toFixed(4) };
        if (m.mae != null) return { label: 'MAE', value: m.mae.toFixed(4) };
        return { label: '—', value: null };
    }
    // classification
    if (m.accuracy != null) return { label: 'Accuracy', value: (m.accuracy * 100).toFixed(1) + '%' };
    return { label: '—', value: null };
}

function getSecondaryMetric(model) {
    if (!model?.metrics) return { label: '—', value: null };
    const m = model.metrics;
    if (model.task_type === 'regression') {
        if (m.rmse != null) return { label: 'RMSE', value: m.rmse.toFixed(4) };
        return { label: '—', value: null };
    }
    if (m.f1_score != null) return { label: 'F1', value: (m.f1_score * 100).toFixed(1) + '%' };
    return { label: '—', value: null };
}

export default function MLTraining() {
    const [models, setModels] = useState([]);
    const [selectedModel, setSelectedModel] = useState('');
    const [manifest, setManifest] = useState(null);
    const [csvPath, setCsvPath] = useState('');
    const [targetColumn, setTargetColumn] = useState('');
    const [autoTune, setAutoTune] = useState(true);
    const [params, setParams] = useState({});
    const [training, setTraining] = useState(false);
    const [result, setResult] = useState(null);
    const [jobId, setJobId] = useState(null);
    const [trainedModels, setTrainedModels] = useState([]);
    const [activeView, setActiveView] = useState('configure');
    const [logs, setLogs] = useState([]);
    const [compareIds, setCompareIds] = useState([]);
    const [detailModel, setDetailModel] = useState(null);
    const [availableColumns, setAvailableColumns] = useState([]);
    const [aiAdvice, setAiAdvice] = useState(null);
    const [isAdvising, setIsAdvising] = useState(false);
    const [aiError, setAiError] = useState('');
    const [aiGoal, setAiGoal] = useState('');

    useEffect(() => {
        fetchModels();
        fetchTrainedModels();
    }, []);

    useEffect(() => {
        if (!jobId || !training) return;
        const interval = setInterval(() => checkJobStatus(jobId), 2000);
        return () => clearInterval(interval);
    }, [jobId, training]);

    useEffect(() => {
        setAiAdvice(null);
        setAiError('');
    }, [detailModel?.job_id, activeView]);

    const addLog = (msg, type = 'info') => {
        setLogs(prev => [...prev, { message: msg, type, time: new Date().toLocaleTimeString() }]);
    };

    const handleAiAdvice = async (mode) => {
        // Fallback to detailModel info if state is empty (useful for history tab)
        // We check multiple potential naming conventions for resilience
        const activeCsv = csvPath || detailModel?.source_csv || detailModel?.csv_path || detailModel?.dataset_path || detailModel?.path;
        const activeTarget = targetColumn || detailModel?.target_column || detailModel?.target;

        console.log('[AI Advisor] state snapshot:', {
            csvPath,
            targetColumn,
            detailModel_source_csv: detailModel?.source_csv,
            detailModel_target_column: detailModel?.target_column,
            detailModel_job_id: detailModel?.job_id,
        });

        if (!activeCsv || !activeTarget) {
            const errorMsg = 'Dataset information or target column not found. Please select a dataset in the Configure tab.';
            addLog(errorMsg, 'error');
            setAiError(errorMsg);
            return;
        }

        setIsAdvising(true);
        setAiAdvice(null);
        setAiError('');
        addLog(`Consulting AI for ${mode} advice…`, 'info');

        try {
            const token = localStorage.getItem('auth_token');
            
            // CONTEXT LOCK: Only send metrics if the results model matches our current selection
            // This prevents "cross-contamination" between different datasets or model types.
            // Note: the API returns the CSV path as 'source_csv', not 'csv_path', so we check both.
            const isMatchingContext =
                detailModel &&
                (detailModel.source_csv === activeCsv || detailModel.csv_path === activeCsv) &&
                detailModel.target_column === activeTarget &&
                detailModel.model_type === (selectedModel || detailModel.model_type);

            // For interpret mode, always send detailModel metrics — the whole point is to
            // analyse the model currently being viewed, regardless of configure-tab state.
            const sendMetrics = mode === 'interpret'
                ? detailModel?.metrics
                : (isMatchingContext ? detailModel?.metrics : null);
            const sendFeatureImportance = mode === 'interpret'
                ? detailModel?.feature_importance
                : (isMatchingContext ? detailModel?.feature_importance : null);

            const res = await fetch(`${API_BASE}/api/ai/ml-advisor`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    mode,
                    dataset_name: activeCsv.split('/').pop(),
                    dataset_path: activeCsv,
                    target_column: activeTarget,
                    current_model_type: selectedModel || detailModel?.model_type,
                    metrics: sendMetrics,
                    feature_importance: sendFeatureImportance,
                    goal: aiGoal.trim() || null
                })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'AI Advisor failed');
            }

            const data = await res.json();
            setAiAdvice({ ...data, mode });
            addLog(`AI ${mode} advice received.`, 'success');

            // Auto-apply logic
            if (mode === 'recommend') {
                const modelId = data.model_type || data.recommended_model;
                handleModelSelect(modelId, data.suggested_params);
                setAutoTune(false);
            } else if (mode === 'tune' && data.suggested_params) {
                setParams(prev => ({ ...prev, ...data.suggested_params }));
                setAutoTune(false);
            }
        } catch (e) {
            setAiError(e.message);
            addLog(`Advice error: ${e.message}`, 'error');
        } finally {
            setIsAdvising(false);
        }
    };

    const fetchColumns = async (path) => {
        try {
            const token = localStorage.getItem('auth_token');
            const res = await fetch(
                `${API_BASE}/api/datasets/csv-columns?path=${encodeURIComponent(path)}`,
                { headers: token ? { Authorization: `Bearer ${token}` } : {} }
            );
            const data = await res.json();
            setAvailableColumns(data.columns || []);
        } catch (_) {
            setAvailableColumns([]);
        }
    };

    const fetchModels = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/ml-training/models`);
            const data = await res.json();
            setModels(data.models || []);
            addLog(`Loaded ${data.models?.length || 0} available models`, 'success');
        } catch (e) {
            addLog('Failed to fetch models: ' + e.message, 'error');
        }
    };

    const handleModelSelect = (m, suggestedParams = null) => {
        setSelectedModel(m);
        fetchManifest(m, suggestedParams);
        setResult(null);
    };

    const fetchManifest = async (modelType, suggestedParams = null) => {
        try {
            const res = await fetch(`${API_BASE}/api/ml-training/models/${modelType}/manifest`);
            const data = await res.json();
            setManifest(data);
            
            const defaults = {};
            Object.entries(data.ui_manifest).forEach(([k, v]) => { 
                defaults[k] = v.default ?? (v.type === 'boolean' ? false : ''); 
            });
            
            // If we have AI suggested params, merge them with defaults
            setParams(suggestedParams ? { ...defaults, ...suggestedParams } : defaults);
        } catch (e) {
            addLog('Failed to fetch manifest: ' + e.message, 'error');
        }
    };

    const fetchTrainedModels = async () => {
        try {
            const token = localStorage.getItem('auth_token');
            const res = await fetch(`${API_BASE}/api/ml-training/models/trained?limit=50`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            const data = await res.json();
            setTrainedModels(data.models || []);
        } catch (e) {
            addLog('Failed to fetch trained models: ' + e.message, 'error');
        }
    };


    const handleTrain = async () => {
        if (!selectedModel || !csvPath || !targetColumn) {
            addLog('Fill in all required fields', 'error');
            return;
        }
        setTraining(true);
        setResult(null);
        addLog(`Training ${selectedModel} on ${csvPath}`, 'info');

        try {
            const res = await fetch(`${API_BASE}/api/ml-training/train`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    csv_path: csvPath,
                    target_column: targetColumn,
                    model_type: selectedModel,
                    auto_tune: autoTune,
                    params: autoTune ? undefined : params,
                }),
            });
            const data = await res.json();
            setJobId(data.job_id);
            addLog(`Job submitted: ${data.job_id}`, 'success');
        } catch (e) {
            setTraining(false);
            addLog('Training failed: ' + e.message, 'error');
        }
    };

    const checkJobStatus = async (id) => {
        try {
            const res = await fetch(`${API_BASE}/api/ml-training/models/trained/${id}`);
            if (res.ok) {
                const data = await res.json();
                setResult(data);
                setTraining(false);
                setDetailModel(data);
                setActiveView('results');
                addLog('Training complete', 'success');
                fetchTrainedModels();
            } else if (res.status === 404) {
                // Still running — not persisted yet, keep polling
            } else {
                // Real error — stop polling and surface it
                const errData = await res.json().catch(() => ({}));
                setTraining(false);
                setJobId(null);
                addLog(`Training failed: ${errData.detail || `HTTP ${res.status}`}`, 'error');
            }
        } catch (e) {
            // Network error — stop polling
            setTraining(false);
            setJobId(null);
            addLog(`Connection error while checking status: ${e.message}`, 'error');
        }
    };

    const toggleCompare = (jobId) => {
        setCompareIds(prev =>
            prev.includes(jobId)
                ? prev.filter(id => id !== jobId)
                : prev.length < 4 ? [...prev, jobId] : prev
        );
    };

    const getMetricsChartData = (metrics) => {
        if (!metrics) return [];
        return Object.entries(metrics)
            .filter(([key, v]) => typeof v === 'number' && key !== 'mse')
            .map(([key, value]) => ({
                name: key.replace(/_/g, ' '),
                value: Math.abs(value),
                rawValue: value,
                fill: METRIC_COLORS[key] || '#555555',
            }));
    };

    const getFeatureImportanceData = (fi) => {
        if (!fi) return [];
        return Object.entries(fi)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([name, value]) => ({ name, value: +(value * 100).toFixed(1) }));
    };

    const getComparisonData = () => {
        if (compareIds.length < 2) return [];
        const selected = trainedModels.filter(m => compareIds.includes(m.job_id));
        const allKeys = new Set();
        selected.forEach(m => Object.keys(m.metrics).forEach(k => allKeys.add(k)));
        return Array.from(allKeys)
            .filter(k => selected.every(m => typeof m.metrics[k] === 'number'))
            .map(metric => {
                const entry = { metric: metric.replace(/_/g, ' ') };
                selected.forEach((m, i) => {
                    entry[`model_${i}`] = +(m.metrics[metric] * 100).toFixed(1);
                    entry[`model_${i}_name`] = m.model_type.replace(/_/g, ' ');
                });
                return entry;
            });
    };

    return (
        <div className="page-container">
            <div className="page-header flex-between">
                <div>
                    <h1 className="page-title">ML Training</h1>
                    <p className="page-description">Train, evaluate, and compare machine learning models</p>
                </div>
                <div className="flex-row gap-sm">
                    <span className="badge badge-neutral">{models.length} models</span>
                    <span className="badge badge-neutral">{trainedModels.length} trained</span>
                </div>
            </div>

            {/* Sub-navigation */}
            <div className="tab-bar">
                <button className={`tab-btn ${activeView === 'configure' ? 'active' : ''}`} onClick={() => setActiveView('configure')}>Configure</button>
                <button className={`tab-btn ${activeView === 'results' ? 'active' : ''}`} onClick={() => setActiveView('results')}>Results</button>
                <button className={`tab-btn ${activeView === 'history' ? 'active' : ''}`} onClick={() => setActiveView('history')}>History</button>
                {compareIds.length >= 2 && (
                    <button className={`tab-btn ${activeView === 'compare' ? 'active' : ''}`} onClick={() => setActiveView('compare')}>
                        Compare ({compareIds.length})
                    </button>
                )}
            </div>

            {/* ============ CONFIGURE TAB ============ */}
            {activeView === 'configure' && (
                <div className="three-col">
                    <div>
                    {/* Goal & Research Panel */}
                    <div className="card" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--color-primary-light)' }}>
                        <div className="card-body">
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                                <Sparkles size={16} style={{ color: 'var(--color-primary)' }} />
                                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-primary)' }}>AI ML Advisor</span>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <input
                                    className="form-input"
                                    placeholder="Describe your research goal (e.g. 'high precision for fraud detection')…"
                                    value={aiGoal}
                                    onChange={e => setAiGoal(e.target.value)}
                                    style={{ fontSize: 12, padding: '6px 10px' }}
                                />
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => handleAiAdvice('recommend')}
                                    disabled={isAdvising || !csvPath || !targetColumn}
                                    style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '6px 12px' }}
                                >
                                    {isAdvising
                                        ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Thinking…</>
                                        : <><Sparkles size={14} /> Smart Start</>}
                                </button>
                            </div>
                            {aiAdvice && aiAdvice.mode === 'recommend' && (
                                <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(79,70,229,0.05)', borderRadius: 6, border: '1px solid rgba(79,70,229,0.1)' }}>
                                    <div style={{ fontSize: 12, color: 'var(--color-primary)', fontWeight: 600, marginBottom: 4 }}>
                                        AI Recommendation: {aiAdvice.recommended_model.replace(/_/g, ' ')}
                                    </div>
                                    <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                                        {aiAdvice.reasoning}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Dataset Config */}
                        <div className="card">
                            <div className="card-header">
                                <span className="card-title">Dataset</span>
                            </div>
                            <div className="card-body">
                                <div className="form-group">
                                    <CsvDatasetPicker
                                        value={csvPath}
                                        onChange={(path) => {
                                            setCsvPath(path);
                                            setTargetColumn('');
                                            fetchColumns(path);
                                        }}
                                        label="CSV Path"
                                    />
                                    <div className="form-hint" style={{ marginTop: 6 }}>
                                        Only datasets saved via "Save to ML Datasets" appear here
                                    </div>
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">Target Column</label>
                                    {availableColumns.length > 0 ? (
                                        <select
                                            className="form-select"
                                            value={targetColumn}
                                            onChange={e => setTargetColumn(e.target.value)}
                                        >
                                            <option value="" disabled>Select target column…</option>
                                            {availableColumns.map(col => (
                                                <option key={col} value={col}>{col}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input
                                            className="form-input"
                                            value={targetColumn}
                                            onChange={e => setTargetColumn(e.target.value)}
                                            placeholder="Select a dataset first"
                                            disabled={!csvPath}
                                        />
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Model Selection */}
                        <div className="card">
                            <div className="card-header">
                                <span className="card-title">Model</span>
                            </div>
                            <div className="card-body">
                                <div className="grid-2" style={{ gap: 8 }}>
                                    {models.map(m => (
                                        <div
                                            key={m}
                                            className={`model-card ${selectedModel === m ? 'selected' : ''}`}
                                            onClick={() => handleModelSelect(m)}
                                            style={aiAdvice?.recommended_model === m ? { border: '1px solid var(--color-primary)', background: 'rgba(79,70,229,0.05)' } : {}}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div className="model-card-name">{m.replace(/_/g, ' ')}</div>
                                                {aiAdvice?.recommended_model === m && <Sparkles size={12} style={{ color: 'var(--color-primary)' }} />}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {models.length === 0 && (
                                    <div className="empty-state" style={{ padding: 'var(--space-md)' }}>
                                        <div className="empty-state-text">No models available. Check backend connection.</div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Hyperparameters */}
                        {manifest && (
                            <div className="card">
                                <div className="card-header">
                                    <span className="card-title">Hyperparameters</span>
                                    <div className="flex-row gap-sm">
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => handleAiAdvice('tune')}
                                            disabled={isAdvising || !selectedModel}
                                            style={{ fontSize: 10, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
                                        >
                                            {isAdvising ? <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={10} />}
                                            AI Suggest
                                        </button>
                                        <div className="checkbox-group">
                                            <input
                                                type="checkbox"
                                                id="auto-tune"
                                                checked={autoTune}
                                                onChange={e => setAutoTune(e.target.checked)}
                                            />
                                            <label htmlFor="auto-tune">Auto-tune</label>
                                        </div>
                                    </div>
                                </div>
                                <div className="card-body" style={{ opacity: autoTune ? 0.4 : 1, pointerEvents: autoTune ? 'none' : 'auto' }}>
                                    {Object.entries(manifest.ui_manifest).map(([key, config]) => (
                                        <div key={key} className="form-group">
                                            <label className="form-label">{config.label}</label>
                                            {config.type === 'range' ? (
                                                <div>
                                                    <input
                                                        type="range"
                                                        min={config.min}
                                                        max={config.max}
                                                        step={config.step}
                                                        value={params[key]}
                                                        onChange={e => setParams({ ...params, [key]: parseFloat(e.target.value) })}
                                                    />
                                                    <span className="mono" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                                                        {params[key]}
                                                    </span>
                                                </div>
                                            ) : config.type === 'choice' ? (
                                                <select
                                                    className="form-select"
                                                    value={params[key]}
                                                    onChange={e => setParams({ ...params, [key]: e.target.value })}
                                                >
                                                    {config.options.map(o => <option key={o} value={o}>{o}</option>)}
                                                </select>
                                            ) : config.type === 'boolean' ? (
                                                <div className="checkbox-group">
                                                    <input
                                                        type="checkbox"
                                                        checked={params[key]}
                                                        onChange={e => setParams({ ...params, [key]: e.target.checked })}
                                                    />
                                                </div>
                                            ) : null}
                                            
                                            {aiAdvice?.mode === 'tune' && aiAdvice.param_explanations?.[key] && (
                                                <div style={{ fontSize: 10, color: 'var(--color-primary)', marginTop: 4, fontStyle: 'italic', display: 'flex', gap: 4 }}>
                                                    <Sparkles size={10} style={{ flexShrink: 0, marginTop: 2 }} />
                                                    {aiAdvice.param_explanations[key]}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Train Button */}
                        <button
                            className="btn btn-primary btn-block"
                            onClick={handleTrain}
                            disabled={training || !selectedModel || !csvPath || !targetColumn}
                            style={{ marginTop: 'var(--space-md)', padding: 12 }}
                        >
                            {training ? (
                                <><span className="spinner" /> Training...</>
                            ) : (
                                <><Play size={14} /> Start Training</>
                            )}
                        </button>
                    </div>

                    {/* Log Panel */}
                    <div>
                        <div className="card" style={{ position: 'sticky', top: 'var(--space-xl)' }}>
                            <div className="card-header">
                                <span className="card-title">Training Log</span>
                                {logs.length > 0 && (
                                    <button className="btn btn-secondary btn-sm" onClick={() => setLogs([])}>Clear</button>
                                )}
                            </div>
                            <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                                <div className="card-body" style={{ padding: 'var(--space-sm) var(--space-md)' }}>
                                    {logs.length === 0 ? (
                                        <div className="empty-state" style={{ padding: 'var(--space-md)' }}>
                                            <div className="empty-state-text">No activity yet</div>
                                        </div>
                                    ) : (
                                        logs.slice().reverse().map((log, i) => (
                                            <div key={i} className={`log-entry ${log.type}`}>
                                                <span className="log-time">{log.time}</span>
                                                <span>{log.message}</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ============ RESULTS TAB ============ */}
            {activeView === 'results' && (
                <div>
                    {!detailModel ? (
                        <div className="card">
                            <div className="card-body empty-state">
                                <Database />
                                <div className="empty-state-title">No model selected</div>
                                <div className="empty-state-text">
                                    Train a model or select one from History to view results
                                </div>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Summary Stats */}
                            <div className="grid-4" style={{ marginBottom: 'var(--space-md)' }}>
                                <div className="stat-card">
                                    <div className="stat-label">Model</div>
                                    <div className="stat-value" style={{ fontSize: 16, textTransform: 'capitalize' }}>
                                        {detailModel.model_type?.replace(/_/g, ' ')}
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-label">Task Type</div>
                                    <div className="stat-value" style={{ fontSize: 16, textTransform: 'capitalize' }}>
                                        {detailModel.task_type}
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-label">Train / Test</div>
                                    <div className="stat-value" style={{ fontSize: 16 }}>
                                        {detailModel.n_samples_train} / {detailModel.n_samples_test}
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-label">Features</div>
                                    <div className="stat-value" style={{ fontSize: 16 }}>{detailModel.n_features}</div>
                                </div>
                            </div>

                            {/* AI Interpretation Panel */}
                            <div className="card" style={{ marginBottom: 'var(--space-md)', background: 'var(--bg-secondary)', border: '1px solid var(--color-primary-light)' }}>
                                <div className="card-header">
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <Sparkles size={16} style={{ color: 'var(--color-primary)' }} />
                                        <span className="card-title" style={{ color: 'var(--color-primary)' }}>AI Performance Analyst</span>
                                    </div>
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => handleAiAdvice('interpret')}
                                        disabled={isAdvising}
                                        style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}
                                    >
                                        {isAdvising ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={12} />}
                                        Interpret with AI
                                    </button>
                                </div>
                                <div className="card-body">
                                    {aiError && (
                                        <div style={{ padding: '8px 12px', background: 'rgba(220, 38, 38, 0.05)', border: '1px solid rgba(220, 38, 38, 0.2)', borderRadius: 6, color: 'var(--color-error)', fontSize: 11, marginBottom: 16 }}>
                                            <strong>AI Advisor Error:</strong> {aiError}
                                        </div>
                                    )}
                                    {aiAdvice && aiAdvice.mode === 'interpret' ? (
                                        <div className="grid-2" style={{ gap: 'var(--space-lg)' }}>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--text-primary)' }}>Strategy Summary</div>
                                                <p style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)', marginBottom: 16 }}>
                                                    {aiAdvice.summary || aiAdvice.performance_summary}
                                                </p>
                                                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Feature Insights</div>
                                                <p style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                                                    "{aiAdvice.feature_insights || aiAdvice.insights}"
                                                </p>
                                            </div>
                                            <div className="grid-2" style={{ gap: 'var(--space-md)' }}>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, color: 'var(--color-success)' }}>Strengths</div>
                                                    <ul style={{ paddingLeft: 16, margin: 0 }}>
                                                        {aiAdvice.strengths.map((s, i) => (
                                                            <li key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{s}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, color: 'var(--color-error)' }}>Weaknesses</div>
                                                    <ul style={{ paddingLeft: 16, margin: 0 }}>
                                                        {aiAdvice.weaknesses.map((w, i) => (
                                                            <li key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{w}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: 12 }}>
                                            Click "Interpret with AI" to get a deep-dive analysis of these metrics.
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Metrics + Feature Importance */}
                            <div className="grid-2">
                                <div className="card">
                                    <div className="card-header">
                                        <span className="card-title">Evaluation Metrics</span>
                                    </div>
                                    <div className="card-body">
                                        <div className="chart-container" style={{ minHeight: 300 }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                {/* Bug 3 fix: domain changed from [0,1] to [0,'auto']
                                                    so regression metrics like MSE/RMSE are not clipped */}
                                                <BarChart data={getMetricsChartData(detailModel.metrics)} layout="vertical">
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e2e4" />
                                                    <XAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 11 }} />
                                                    <YAxis
                                                        type="category"
                                                        dataKey="name"
                                                        width={90}
                                                        tick={{ fontSize: 11 }}
                                                        style={{ textTransform: 'capitalize' }}
                                                    />
                                                    <Tooltip
                                                        formatter={(val, name, props) => [
                                                            props.payload.rawValue?.toFixed(4),
                                                            props.payload.name
                                                        ]}
                                                        contentStyle={{ fontSize: 12, border: '1px solid #e2e2e4', borderRadius: 4 }}
                                                    />
                                                    <Bar dataKey="value" radius={[0, 2, 2, 0]} barSize={20}>
                                                        {getMetricsChartData(detailModel.metrics).map((entry, i) => (
                                                            <Cell key={i} fill={entry.fill} />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>

                                        <div style={{ marginTop: 'var(--space-md)' }}>
                                            {Object.entries(detailModel.metrics)
                                                .filter(([, v]) => typeof v === 'number')
                                                .map(([key, value]) => (
                                                    <div key={key} className="flex-between" style={{ padding: '4px 0', borderBottom: '1px solid var(--border-light)' }}>
                                                        <span style={{ fontSize: 12, textTransform: 'capitalize' }}>
                                                            {key.replace(/_/g, ' ')}
                                                        </span>
                                                        <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                                                            {value.toFixed(4)}
                                                        </span>
                                                    </div>
                                                ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Feature Importance */}
                                <div className="card">
                                    <div className="card-header">
                                        <span className="card-title">Feature Importance</span>
                                        <span className="badge badge-neutral">Top 12</span>
                                    </div>
                                    <div className="card-body">
                                        <div className="chart-container">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={getFeatureImportanceData(detailModel.feature_importance)} layout="vertical">
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e2e4" />
                                                    <XAxis type="number" tick={{ fontSize: 11 }} unit="%" />
                                                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                                                    <Tooltip
                                                        formatter={(val) => [`${val}%`, 'Importance']}
                                                        contentStyle={{ fontSize: 12, border: '1px solid #e2e2e4', borderRadius: 4 }}
                                                    />
                                                    <Bar dataKey="value" fill="#111111" radius={[0, 2, 2, 0]} barSize={14} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>

                                        <div style={{ marginTop: 'var(--space-md)' }}>
                                            {getFeatureImportanceData(detailModel.feature_importance).map(f => (
                                                <div key={f.name} className="flex-between" style={{ padding: '3px 0' }}>
                                                    <span className="mono" style={{ fontSize: 11 }}>{f.name}</span>
                                                    <div className="flex-row" style={{ gap: 8 }}>
                                                        <div style={{ width: 60, height: 4, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden' }}>
                                                            <div style={{ width: `${f.value}%`, height: '100%', background: 'var(--text-primary)', borderRadius: 2 }} />
                                                        </div>
                                                        <span className="mono" style={{ fontSize: 11, width: 40, textAlign: 'right' }}>{f.value}%</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Hyperparameters */}
                            {detailModel.hyperparameters && (
                                <div className="card" style={{ marginTop: 'var(--space-md)' }}>
                                    <div className="card-header">
                                        <span className="card-title">Hyperparameters</span>
                                    </div>
                                    <div className="card-body">
                                        <div className="data-table-wrapper">
                                            <table className="data-table">
                                                <thead>
                                                    <tr><th>Parameter</th><th>Value</th></tr>
                                                </thead>
                                                <tbody>
                                                    {Object.entries(detailModel.hyperparameters).map(([k, v]) => (
                                                        <tr key={k}>
                                                            <td className="mono">{k}</td>
                                                            <td className="mono">{JSON.stringify(v)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <PredictionTester model={detailModel} />
                            <ModelApiDocs model={detailModel} />
                        </>
                    )}
                </div>
            )}

            {/* ============ HISTORY TAB ============ */}
            {activeView === 'history' && (
                <div>
                    {compareIds.length >= 2 && (
                        <div style={{ marginBottom: 'var(--space-md)' }}>
                            <button className="btn btn-primary" onClick={() => setActiveView('compare')}>
                                Compare {compareIds.length} Models <ArrowRight size={14} />
                            </button>
                        </div>
                    )}

                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Trained Models</span>
                            <span className="badge badge-neutral">{trainedModels.length}</span>
                        </div>
                        <div className="data-table-wrapper">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: 30 }}></th>
                                        <th>Model</th>
                                        <th>Type</th>
                                        <th>Primary</th>
                                        <th>Secondary</th>
                                        <th>Train</th>
                                        <th>Test</th>
                                        <th>Features</th>
                                        <th>Date</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {trainedModels.map(m => {
                                        const primary = getPrimaryMetric(m);
                                        const secondary = getSecondaryMetric(m);
                                        return (
                                            <tr key={m.job_id}>
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        checked={compareIds.includes(m.job_id)}
                                                        onChange={() => toggleCompare(m.job_id)}
                                                        style={{ accentColor: '#111' }}
                                                    />
                                                </td>
                                                <td style={{ fontWeight: 500, textTransform: 'capitalize' }}>
                                                    {m.model_type.replace(/_/g, ' ')}
                                                    <OwnershipBadge ownerUsername={m.owner_username} />
                                                </td>
                                                <td>
                                                    <span className="badge badge-neutral">{m.task_type}</span>
                                                </td>
                                                <td className="mono" style={{ fontWeight: 600 }} title={primary.label}>
                                                    {primary.value ?? '—'}
                                                </td>
                                                <td className="mono" title={secondary.label}>
                                                    {secondary.value ?? '—'}
                                                </td>
                                                <td className="mono">{m.n_samples_train}</td>
                                                <td className="mono">{m.n_samples_test}</td>
                                                <td className="mono">{m.n_features}</td>
                                                <td style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                                                    {new Date(m.created_at).toLocaleDateString()}
                                                </td>
                                                <td>
                                                    <button
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => {
                                                            setDetailModel(m);
                                                            setCsvPath(m.source_csv || '');
                                                            setTargetColumn(m.target_column || '');
                                                            setActiveView('results');
                                                        }}
                                                    >
                                                        View
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {trainedModels.length === 0 && (
                            <div className="card-body empty-state">
                                <Database />
                                <div className="empty-state-title">No trained models yet</div>
                                <div className="empty-state-text">Train a model from the Configure tab</div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ============ COMPARE TAB ============ */}
            {activeView === 'compare' && (
                <div>
                    <div className="flex-between" style={{ marginBottom: 'var(--space-md)' }}>
                        <div className="flex-row gap-sm">
                            {compareIds.map(id => {
                                const m = trainedModels.find(t => t.job_id === id);
                                return m ? (
                                    <span key={id} className="badge badge-neutral flex-row" style={{ gap: 4 }}>
                                        {m.model_type.replace(/_/g, ' ')}
                                        <X
                                            size={10}
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => {
                                                toggleCompare(id);
                                                if (compareIds.length <= 2) setActiveView('history');
                                            }}
                                        />
                                    </span>
                                ) : null;
                            })}
                        </div>
                    </div>

                    {/* Side-by-side metrics */}
                    <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
                        <div className="card-header">
                            <span className="card-title">Metric Comparison</span>
                        </div>
                        <div className="card-body">
                            <div className="chart-container">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={getComparisonData()}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e2e4" />
                                        <XAxis dataKey="metric" tick={{ fontSize: 11 }} style={{ textTransform: 'capitalize' }} />
                                        <YAxis tick={{ fontSize: 11 }} />
                                        <Tooltip
                                            contentStyle={{ fontSize: 12, border: '1px solid #e2e2e4', borderRadius: 4 }}
                                            formatter={(val, name) => {
                                                const idx = parseInt(name.split('_')[1]);
                                                const d = getComparisonData()[0];
                                                const modelName = d?.[`model_${idx}_name`] || name;
                                                return [`${val}%`, modelName];
                                            }}
                                        />
                                        {compareIds.map((_, i) => (
                                            <Bar
                                                key={i}
                                                dataKey={`model_${i}`}
                                                fill={['#111111', '#888888', '#2563eb', '#d97706'][i]}
                                                radius={[2, 2, 0, 0]}
                                                barSize={24}
                                            />
                                        ))}
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    {/* Comparison Table */}
                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Detailed Comparison</span>
                        </div>
                        <div className="data-table-wrapper">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Property</th>
                                        {compareIds.map(id => {
                                            const m = trainedModels.find(t => t.job_id === id);
                                            return (
                                                <th key={id} style={{ textTransform: 'capitalize' }}>
                                                    {m?.model_type.replace(/_/g, ' ') || id}
                                                </th>
                                            );
                                        })}
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td style={{ fontWeight: 500 }}>Task Type</td>
                                        {compareIds.map(id => {
                                            const m = trainedModels.find(t => t.job_id === id);
                                            return <td key={id}><span className="badge badge-neutral">{m?.task_type}</span></td>;
                                        })}
                                    </tr>
                                    {(() => {
                                        const allMetrics = new Set();
                                        compareIds.forEach(id => {
                                            const m = trainedModels.find(t => t.job_id === id);
                                            if (m) Object.keys(m.metrics).forEach(k => allMetrics.add(k));
                                        });
                                        return Array.from(allMetrics).map(metric => {
                                            const values = compareIds.map(id => {
                                                const m = trainedModels.find(t => t.job_id === id);
                                                return m?.metrics[metric];
                                            });
                                            const best = Math.max(...values.filter(v => v != null));
                                            return (
                                                <tr key={metric}>
                                                    <td style={{ fontWeight: 500, textTransform: 'capitalize' }}>
                                                        {metric.replace(/_/g, ' ')}
                                                    </td>
                                                    {values.map((v, i) => (
                                                        <td key={i} className="mono" style={{
                                                            fontWeight: v === best ? 700 : 400,
                                                            color: v === best ? 'var(--color-success)' : undefined,
                                                        }}>
                                                            {v != null ? v.toFixed(4) : '—'}
                                                        </td>
                                                    ))}
                                                </tr>
                                            );
                                        });
                                    })()}
                                    <tr>
                                        <td style={{ fontWeight: 500 }}>Train Samples</td>
                                        {compareIds.map(id => {
                                            const m = trainedModels.find(t => t.job_id === id);
                                            return <td key={id} className="mono">{m?.n_samples_train}</td>;
                                        })}
                                    </tr>
                                    <tr>
                                        <td style={{ fontWeight: 500 }}>Test Samples</td>
                                        {compareIds.map(id => {
                                            const m = trainedModels.find(t => t.job_id === id);
                                            return <td key={id} className="mono">{m?.n_samples_test}</td>;
                                        })}
                                    </tr>
                                    <tr>
                                        <td style={{ fontWeight: 500 }}>Features</td>
                                        {compareIds.map(id => {
                                            const m = trainedModels.find(t => t.job_id === id);
                                            return <td key={id} className="mono">{m?.n_features}</td>;
                                        })}
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}