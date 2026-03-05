import React, { useState, useEffect, useRef } from 'react';
import {
    Wrench, Plus, Trash2, Play, AlertCircle, CheckCircle, ChevronDown
} from 'lucide-react';
import CsvDatasetPicker from './CsvDatasetPicker';

const API_BASE = 'http://localhost:8000';

const AVAILABLE_STEPS = [
    {
        id: 'drop_nulls',
        label: 'Drop Null Rows',
        description: 'Remove rows with missing values',
        params: [
            { key: 'subset', label: 'Columns (comma-separated, blank for all)', type: 'text', default: '' }
        ]
    },
    {
        id: 'fill_missing',
        label: 'Fill Missing Values',
        description: 'Replace missing values with a strategy',
        params: [
            { key: 'strategy', label: 'Strategy', type: 'select', options: ['mean', 'median', 'mode', 'constant'], default: 'mean' },
            { key: 'fill_value', label: 'Constant value (if strategy=constant)', type: 'text', default: '0' }
        ]
    },
    {
        id: 'remove_duplicates',
        label: 'Remove Duplicates',
        description: 'Drop duplicate rows',
        params: [
            { key: 'subset', label: 'Columns (comma-separated, blank for all)', type: 'text', default: '' }
        ]
    },
    {
        id: 'normalize',
        label: 'Normalize',
        description: 'Scale numeric columns to a range',
        params: [
            { key: 'method', label: 'Method', type: 'select', options: ['min_max', 'z_score', 'robust'], default: 'min_max' },
            { key: 'columns', label: 'Columns (comma-separated, blank for all numeric)', type: 'text', default: '' }
        ]
    },
    {
        id: 'encode_categorical',
        label: 'Encode Categorical',
        description: 'Convert categorical columns to numeric',
        params: [
            { key: 'method', label: 'Method', type: 'select', options: ['label', 'one_hot'], default: 'label' },
            { key: 'columns', label: 'Columns (comma-separated)', type: 'text', default: '' }
        ]
    },
    {
        id: 'drop_columns',
        label: 'Drop Columns',
        description: 'Remove specified columns',
        params: [
            { key: 'columns', label: 'Columns to drop (comma-separated)', type: 'text', default: '' }
        ]
    },
    {
        id: 'rename_columns',
        label: 'Rename Columns',
        description: 'Rename columns using a mapping',
        params: [
            { key: 'mapping', label: 'Mapping (old:new, comma-separated)', type: 'text', default: '' }
        ]
    }
];

export default function DataProcessing() {
    const [datasetName, setDatasetName] = useState('');
    const [pipeline, setPipeline] = useState([]);
    const [processing, setProcessing] = useState(false);
    const [jobId, setJobId] = useState(null);
    const [logs, setLogs] = useState([]);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const wsRef = useRef(null);

    useEffect(() => {
        return () => {
            if (wsRef.current) wsRef.current.close();
        };
    }, []);

    const addLog = (message, type = 'info') => {
        setLogs(prev => [...prev, { message, type, time: new Date().toLocaleTimeString() }]);
    };

    const addStep = (stepDef) => {
        const params = {};
        stepDef.params.forEach(p => { params[p.key] = p.default; });
        setPipeline(prev => [...prev, { step: stepDef.id, label: stepDef.label, params }]);
    };

    const removeStep = (index) => {
        setPipeline(prev => prev.filter((_, i) => i !== index));
    };

    const updateStepParam = (stepIndex, key, value) => {
        setPipeline(prev => prev.map((step, i) => {
            if (i !== stepIndex) return step;
            return { ...step, params: { ...step.params, [key]: value } };
        }));
    };

    const connectWebSocket = () => {
        try {
            const ws = new WebSocket('ws://localhost:8000/websocket/crawl_events');
            wsRef.current = ws;

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'ml_job') {
                        if (data.status === 'completed') {
                            setProcessing(false);
                            setResult(data);
                            addLog(`Processing complete. ${data.total_rows} rows, ${data.columns?.length} columns`, 'success');
                        } else if (data.status === 'failed') {
                            setProcessing(false);
                            setError(data.error);
                            addLog(`Processing failed: ${data.error}`, 'error');
                        } else if (data.status === 'started') {
                            addLog('Pipeline execution started...', 'info');
                        }
                    }
                } catch (e) {
                    // Non-JSON message
                }
            };

            ws.onerror = () => addLog('WebSocket connection error', 'error');
            ws.onclose = () => addLog('WebSocket disconnected', 'info');
        } catch (e) {
            addLog('Cannot connect to WebSocket', 'error');
        }
    };

    const handleRun = async () => {
        if (!datasetName.trim() || pipeline.length === 0) {
            setError('Enter a dataset name and add at least one processing step');
            return;
        }

        setProcessing(true);
        setResult(null);
        setError(null);
        addLog(`Submitting pipeline: ${pipeline.length} steps on "${datasetName}"`, 'info');

        // Connect WebSocket for real-time updates
        connectWebSocket();

        try {
            const steps = pipeline.map(s => ({
                step: s.step,
                params: Object.fromEntries(
                    Object.entries(s.params).filter(([, v]) => v !== '')
                )
            }));

            const response = await fetch(`${API_BASE}/api/process`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dataset_name: datasetName, steps })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || 'Processing request failed');
            }

            const data = await response.json();
            setJobId(data.job_id);
            addLog(`Job submitted: ${data.job_id}`, 'success');
        } catch (err) {
            setProcessing(false);
            setError(err.message);
            addLog(`Error: ${err.message}`, 'error');
        }
    };

    const getStepDef = (stepId) => AVAILABLE_STEPS.find(s => s.id === stepId);

    return (
        <div className="page-container">
            <div className="page-header">
                <h1 className="page-title">Data Processing</h1>
                <p className="page-description">Build and execute data cleaning and feature engineering pipelines</p>
            </div>

            <div className="three-col">
                {/* Main Panel */}
                <div>
                    {/* Dataset Input */}
                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Source Dataset</span>
                        </div>
                        <div className="card-body">
                            <CsvDatasetPicker
                                value={datasetName}
                                onChange={(path, name) => setDatasetName(name)}
                                label="Source Dataset"
                            />
                            <div className="form-hint" style={{ marginTop: 6 }}>
                                Only datasets saved via "Save to ML Datasets" appear here
                            </div>
                        </div>
                    </div>

                    {/* Pipeline Builder */}
                    <div className="card">
                        <div className="card-header">
                            <span className="card-title">Pipeline Steps</span>
                            <span className="badge badge-neutral">{pipeline.length}</span>
                        </div>
                        <div className="card-body">
                            {pipeline.length === 0 ? (
                                <div className="empty-state" style={{ padding: 'var(--space-lg)' }}>
                                    <Wrench />
                                    <div className="empty-state-title">No steps added</div>
                                    <div className="empty-state-text">Use the dropdown below to add processing steps</div>
                                </div>
                            ) : (
                                pipeline.map((step, idx) => {
                                    const def = getStepDef(step.step);
                                    return (
                                        <div key={idx} className="pipeline-step">
                                            <div className="pipeline-step-number">{idx + 1}</div>
                                            <div className="pipeline-step-content">
                                                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                                                    {step.label}
                                                </div>
                                                {def && def.params.map(p => (
                                                    <div key={p.key} className="form-group" style={{ marginBottom: 8 }}>
                                                        <label className="form-label" style={{ fontSize: 10, marginBottom: 2 }}>
                                                            {p.label}
                                                        </label>
                                                        {p.type === 'select' ? (
                                                            <select
                                                                className="form-select"
                                                                value={step.params[p.key]}
                                                                onChange={e => updateStepParam(idx, p.key, e.target.value)}
                                                                style={{ padding: '4px 8px', fontSize: 12 }}
                                                            >
                                                                {p.options.map(opt => (
                                                                    <option key={opt} value={opt}>{opt}</option>
                                                                ))}
                                                            </select>
                                                        ) : (
                                                            <input
                                                                className="form-input"
                                                                value={step.params[p.key]}
                                                                onChange={e => updateStepParam(idx, p.key, e.target.value)}
                                                                style={{ padding: '4px 8px', fontSize: 12 }}
                                                            />
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="pipeline-step-actions">
                                                <button
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => removeStep(idx)}
                                                    title="Remove step"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            )}

                            {/* Add Step Dropdown */}
                            <div style={{ marginTop: 'var(--space-md)' }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <select
                                        className="form-select"
                                        value=""
                                        onChange={e => {
                                            const def = AVAILABLE_STEPS.find(s => s.id === e.target.value);
                                            if (def) addStep(def);
                                        }}
                                        style={{ color: 'var(--text-tertiary)' }}
                                    >
                                        <option value="" disabled>+ Add processing step...</option>
                                        {AVAILABLE_STEPS.map(s => (
                                            <option key={s.id} value={s.id}>{s.label} — {s.description}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Execute */}
                    <button
                        className="btn btn-primary btn-block"
                        onClick={handleRun}
                        disabled={processing || !datasetName || pipeline.length === 0}
                        style={{ marginTop: 'var(--space-md)', padding: '12px' }}
                    >
                        {processing ? (
                            <><span className="spinner" /> Processing...</>
                        ) : (
                            <><Play size={14} /> Execute Pipeline</>
                        )}
                    </button>

                    {/* Error */}
                    {error && (
                        <div className="card" style={{ marginTop: 'var(--space-md)' }}>
                            <div className="card-body flex-row" style={{ color: 'var(--color-error)' }}>
                                <AlertCircle size={16} />
                                <span style={{ fontSize: 13 }}>{error}</span>
                            </div>
                        </div>
                    )}

                    {/* Result Preview */}
                    {result && (
                        <div className="card" style={{ marginTop: 'var(--space-md)' }}>
                            <div className="card-header">
                                <span className="card-title flex-row">
                                    <CheckCircle size={14} style={{ color: 'var(--color-success)' }} />
                                    Processing Result
                                </span>
                            </div>
                            <div className="card-body">
                                <div className="grid-3" style={{ marginBottom: 'var(--space-md)' }}>
                                    <div className="stat-card">
                                        <div className="stat-label">Output Rows</div>
                                        <div className="stat-value">{result.total_rows?.toLocaleString()}</div>
                                    </div>
                                    <div className="stat-card">
                                        <div className="stat-label">Columns</div>
                                        <div className="stat-value">{result.columns?.length}</div>
                                    </div>
                                </div>

                                {result.columns && (
                                    <div>
                                        <div className="form-label" style={{ marginBottom: 8 }}>Output Columns</div>
                                        <div className="flex-row" style={{ flexWrap: 'wrap', gap: 4 }}>
                                            {result.columns.map(col => (
                                                <span key={col} className="badge badge-neutral">{col}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {result.preview && (
                                    <div style={{ marginTop: 'var(--space-md)' }}>
                                        <div className="form-label" style={{ marginBottom: 8 }}>Preview (first 5 rows)</div>
                                        <div className="data-table-wrapper">
                                            <table className="data-table">
                                                <thead>
                                                    <tr>
                                                        {result.columns.map(col => <th key={col}>{col}</th>)}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {result.preview.map((row, idx) => (
                                                        <tr key={idx}>
                                                            {result.columns.map(col => (
                                                                <td key={col} className="mono">{row[col] ?? '—'}</td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}

                                {result.logs && result.logs.length > 0 && (
                                    <div style={{ marginTop: 'var(--space-md)' }}>
                                        <div className="form-label" style={{ marginBottom: 8 }}>Operation Log</div>
                                        {result.logs.map((log, idx) => (
                                            <div key={idx} className="log-entry info">
                                                <span className="mono" style={{ fontSize: 12 }}>{log}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Side Panel — Activity Log */}
                <div className="card" style={{ position: 'sticky', top: 'var(--space-xl)' }}>
                    <div className="card-header">
                        <span className="card-title">Activity Log</span>
                        {logs.length > 0 && (
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setLogs([])}
                            >
                                Clear
                            </button>
                        )}
                    </div>
                    <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                        {logs.length === 0 ? (
                            <div className="card-body empty-state" style={{ padding: 'var(--space-lg)' }}>
                                <div className="empty-state-text">No activity yet</div>
                            </div>
                        ) : (
                            <div className="card-body" style={{ padding: 'var(--space-sm) var(--space-md)' }}>
                                {logs.slice().reverse().map((log, idx) => (
                                    <div key={idx} className={`log-entry ${log.type}`}>
                                        <span className="log-time">{log.time}</span>
                                        <span>{log.message}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
