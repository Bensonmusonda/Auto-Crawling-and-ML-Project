import React, { useState, useEffect, useRef } from 'react';
import {
    Wrench, Trash2, Play, AlertCircle, CheckCircle, ChevronDown, Columns, Sparkles, Loader, GripVertical
} from 'lucide-react';
import CsvDatasetPicker from './CsvDatasetPicker';

const API_BASE = 'http://localhost:8000';

const AVAILABLE_STEPS = [
    {
        id: 'drop_missing',
        label: 'Drop Null Rows',
        description: 'Remove rows with missing values',
        params: [
            { key: 'subset', label: 'Columns (blank for all)', type: 'multicolumn', default: '' }
        ]
    },
    {
        id: 'impute',
        label: 'Fill Missing Values',
        description: 'Replace missing values with a strategy',
        params: [
            { key: 'column', label: 'Column', type: 'singlecolumn', default: '' },
            { key: 'strategy', label: 'Strategy', type: 'select', options: ['mean', 'median', 'mode', 'constant'], default: 'mean' },
            { key: 'fill_value', label: 'Constant value (if strategy=constant)', type: 'text', default: '0' }
        ]
    },
    {
        id: 'remove_duplicates',
        label: 'Remove Duplicates',
        description: 'Drop duplicate rows',
        params: [
            { key: 'subset', label: 'Columns (blank for all)', type: 'multicolumn', default: '' }
        ]
    },
    {
        id: 'scale_features',
        label: 'Scale/Normalize',
        description: 'Scale numeric columns to a range',
        params: [
            { key: 'method', label: 'Method', type: 'select', options: ['minmax', 'standard', 'robust'], default: 'minmax' },
            { key: 'column', label: 'Column', type: 'singlecolumn', default: '' }
        ]
    },
    {
        id: 'encode_categorical',
        label: 'Encode Categorical',
        description: 'Convert categorical columns to numeric',
        params: [
            { key: 'columns', label: 'Columns', type: 'multicolumn', default: '' },
            { key: 'method', label: 'Method', type: 'select', options: ['label', 'one_hot'], default: 'label' }
        ]
    },
    {
        id: 'label_encode',
        label: 'Label Encode',
        description: 'Convert categorical text to integers (e.g. A,B,C -> 0,1,2)',
        params: [
            { key: 'column', label: 'Column', type: 'singlecolumn', default: '' }
        ]
    },
    {
        id: 'one_hot_encode',
        label: 'One-Hot Encode',
        description: 'Convert categorical column to multiple binary columns',
        params: [
            { key: 'column', label: 'Column', type: 'singlecolumn', default: '' }
        ]
    },
    {
        id: 'drop_columns',
        label: 'Drop Columns',
        description: 'Remove specified columns',
        params: [
            { key: 'columns', label: 'Columns to drop', type: 'multicolumn', default: '' }
        ]
    },
    {
        id: 'rename_columns',
        label: 'Rename Columns',
        description: 'Rename columns using a mapping',
        params: [
            { key: 'mapping', label: 'Mapping (old:new, comma-separated)', type: 'text', default: '' }
        ]
    },
    {
        id: 'filter_rows',
        label: 'Filter Rows',
        description: 'Remove rows with empty or specific values',
        params: [
            { key: 'column', label: 'Column', type: 'singlecolumn', default: '' },
            { key: 'exclude', label: 'Values to exclude (comma-separated)', type: 'text', default: '' }
        ]
    },
    {
        id: 'clean_numeric_column',
        label: 'Clean Numeric Column',
        description: 'Strip HTML tags/chars and convert to number',
        params: [
            { key: 'column', label: 'Column name', type: 'singlecolumn', default: '' },
            { key: 'strip_chars', label: 'Characters to strip (e.g. US $, out of 5 stars)', type: 'text', default: '' }
        ]
    },
    {
        id: 'convert_type',
        label: 'Convert Type',
        description: 'Force a column to numeric, datetime, or string',
        params: [
            { key: 'column', label: 'Column', type: 'singlecolumn', default: '' },
            { key: 'dtype', label: 'Data Type', type: 'select', options: ['numeric', 'datetime', 'string'], default: 'numeric' }
        ]
    },
    {
        id: 'clean_text',
        label: 'Clean Text',
        description: 'Remove HTML, special chars, and lowercase text',
        params: [
            { key: 'column', label: 'Column', type: 'singlecolumn', default: '' }
        ]
    },
    {
        id: 'sentiment_analysis',
        label: 'Sentiment Analysis',
        description: 'Calculate sentiment polarity for a text column',
        params: [
            { key: 'column', label: 'Column', type: 'singlecolumn', default: '' }
        ]
    },
    {
        id: 'ner_extract',
        label: 'Extract Entities (NER)',
        description: 'Extract specific entities like ORG, PERSON, GPE from text',
        params: [
            { key: 'column', label: 'Column', type: 'singlecolumn', default: '' },
            { key: 'entity_types', label: 'Entity Types (comma-separated)', type: 'text', default: 'ORG,PERSON,GPE' }
        ]
    },
    {
        id: 'extract_keywords',
        label: 'Extract Keywords',
        description: 'Extract top keywords using TF-IDF',
        params: [
            { key: 'column', label: 'Column', type: 'singlecolumn', default: '' },
            { key: 'top_n', label: 'Top N Keywords', type: 'text', default: '3' }
        ]
    },
    {
        id: 'detect_language',
        label: 'Detect Language',
        description: 'Detect the language of text in a column',
        params: [
            { key: 'column', label: 'Column', type: 'singlecolumn', default: '' }
        ]
    },
    {
        id: 'text_vectorize',
        label: 'Vectorize Text (TF-IDF)',
        description: 'Convert a text column into numerical TF-IDF features',
        params: [
            { key: 'column', label: 'Column', type: 'singlecolumn', default: '' },
            { key: 'max_features', label: 'Max Features', type: 'text', default: '50' }
        ]
    },
    {
        id: 'regex_extract',
        label: 'Regex Extract (AI-Assisted)',
        description: 'Extract a substring using a regex pattern (AI can generate the pattern for you)',
        params: [
            { key: 'column', label: 'Source Column', type: 'singlecolumn', default: '' },
            { key: 'pattern', label: 'Regex Pattern', type: 'text', default: '' },
            { key: 'new_col_name', label: 'New Column Name (optional)', type: 'text', default: '' }
        ]
    }
];

// Map AI aliases to the primary step definitions found in AVAILABLE_STEPS
const OP_ALIASES = {
    'one_hot': 'one_hot_encode',
    'label': 'label_encode',
    'scale': 'scale_features',
    'normalize': 'scale_features',
    'fill_missing': 'impute',
    'drop_nulls': 'drop_missing',
    'sentiment': 'sentiment_analysis',
    'one_hot_encode': 'one_hot_encode',
    'label_encode': 'label_encode',
    'scale_features': 'scale_features',
    'impute': 'impute',
    'drop_missing': 'drop_missing',
    'encode_categorical': 'encode_categorical'
};

const getStepDef = (id) => {
    const primaryId = OP_ALIASES[id] || id;
    return AVAILABLE_STEPS.find(s => s.id === primaryId);
};

// Column multi-select dropdown component
function ColumnPicker({ value, onChange, availableColumns, placeholder = 'Select columns…' }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    let selected = [];
    if (Array.isArray(value)) {
        selected = value.filter(Boolean);
    } else if (typeof value === 'string') {
        selected = value.split(',').map(s => s.trim()).filter(Boolean);
    }

    const toggle = (col) => {
        const next = selected.includes(col)
            ? selected.filter(c => c !== col)
            : [...selected, col];
        onChange(next.join(', '));
    };

    useEffect(() => {
        const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    if (!availableColumns || availableColumns.length === 0) {
        return (
            <input
                className="form-input"
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder="Select a dataset first"
                style={{ padding: '4px 8px', fontSize: 12 }}
            />
        );
    }

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <div
                className="form-input"
                onClick={() => setOpen(o => !o)}
                style={{
                    padding: '4px 8px', fontSize: 12, cursor: 'pointer',
                    minHeight: 30, display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', userSelect: 'none'
                }}
            >
                <span style={{ color: selected.length ? 'inherit' : 'var(--text-muted)' }}>
                    {selected.length > 0 ? selected.join(', ') : placeholder}
                </span>
                <ChevronDown size={12} style={{ flexShrink: 0, marginLeft: 4 }} />
            </div>
            {open && (
                <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0,
                    background: 'var(--bg-primary)', border: '1px solid var(--border-light)',
                    borderRadius: 'var(--radius-md)', zIndex: 100, maxHeight: 200,
                    overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                }}>
                    <div
                        style={{
                            padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)',
                            borderBottom: '1px solid var(--border-light)', cursor: 'pointer'
                        }}
                        onClick={() => onChange('')}
                    >
                        Clear selection (use all)
                    </div>
                    {availableColumns.map(col => (
                        <div
                            key={col}
                            onClick={() => toggle(col)}
                            style={{
                                padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 8,
                                background: selected.includes(col) ? 'var(--bg-secondary)' : 'transparent',
                                color: selected.includes(col) ? 'var(--color-primary)' : 'inherit'
                            }}
                        >
                            <input
                                type="checkbox"
                                readOnly
                                checked={selected.includes(col)}
                                style={{ accentColor: 'var(--color-primary)', pointerEvents: 'none' }}
                            />
                            <span className="mono">{col}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function DataProcessing() {
    const [datasetName, setDatasetName] = useState('');
    const [csvPath, setCsvPath] = useState('');
    const [availableColumns, setAvailableColumns] = useState([]);
    const [pipeline, setPipeline] = useState([]);
    const [processing, setProcessing] = useState(false);
    const [jobId, setJobId] = useState(null);
    const [logs, setLogs] = useState([]);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [isSuggesting, setIsSuggesting] = useState(false);
    const [suggestError, setSuggestError] = useState(null);
    const [aiGoal, setAiGoal] = useState('');
    const [aiSummary, setAiSummary] = useState(null);
    const [suggestedModels, setSuggestedModels] = useState([]);
    const [regexIntents, setRegexIntents] = useState({});
    const [generatingRegexFor, setGeneratingRegexFor] = useState(null);
    const [draggingIdx, setDraggingIdx] = useState(null);
    const wsRef = useRef(null);

    useEffect(() => {
        return () => { if (wsRef.current) wsRef.current.close(); };
    }, []);

    const fetchColumns = async (path) => {
        if (!path) return;
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

    const addLog = (message, type = 'info') => {
        setLogs(prev => [...prev, { message, type, time: new Date().toLocaleTimeString() }]);
    };

    // --- AI: Auto-suggest pipeline steps ---
    const handleAutoSuggest = async () => {
        if (!datasetName) {
            setSuggestError('Please select a dataset first.');
            return;
        }
        setIsSuggesting(true);
        setSuggestError(null);
        setAiSummary(null);
        setSuggestedModels([]);
        
        addLog('Asking AI for a strategic analysis and pipeline suggestion…', 'info');
        try {
            const token = localStorage.getItem('auth_token');
            const res = await fetch(`${API_BASE}/api/ai/suggest-pipeline`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ 
                    dataset_name: datasetName,
                    dataset_path: csvPath || null,
                    goal: aiGoal.trim() || null
                })
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'AI suggestion failed');
            }
            const data = await res.json();
            
            setAiSummary(data.overall_summary);
            setSuggestedModels(data.suggested_models || []);
            
            const suggested = data.suggested_steps || [];
            if (suggested.length === 0) {
                addLog('AI returned no specific suggestions for this dataset.', 'info');
                return;
            }
            
            // Map each AI-suggested step to our internal pipeline format
            const newSteps = suggested.map(s => {
                const def = getStepDef(s.step);
                return {
                    step: def ? def.id : s.step, // Use primary ID
                    label: def ? def.label : s.step,
                    params: s.params || {},
                    aiReasoning: s.reasoning || null,
                    aiGenerated: true,
                    draft: true // Mark as draft until user interacts or runs
                };
            });
            
            setPipeline(prev => [...prev.filter(s => !s.draft), ...newSteps]);
            addLog(`AI analysis complete. Suggested ${newSteps.length} steps and ${data.suggested_models?.length} model(s).`, 'success');
        } catch (e) {
            setSuggestError(e.message);
            addLog(`AI suggestion error: ${e.message}`, 'error');
        } finally {
            setIsSuggesting(false);
        }
    };

    const approveAllDrafts = () => {
        setPipeline(prev => prev.map(s => ({ ...s, draft: false })));
        addLog('All AI suggestions approved.', 'success');
    };

    const dismissAllDrafts = () => {
        setPipeline(prev => prev.filter(s => !s.draft));
        setAiSummary(null);
        setSuggestedModels([]);
        addLog('AI suggestions dismissed.', 'info');
    };

    // --- AI: Generate a regex pattern for a specific pipeline step ---
    const handleGenerateRegex = async (stepIndex) => {
        const step = pipeline[stepIndex];
        const column = step?.params?.column;
        const intent = regexIntents[stepIndex] || '';
        if (!column) { addLog('Select a column first before generating a regex.', 'error'); return; }
        if (!intent.trim()) { addLog('Please describe what you want to extract.', 'error'); return; }
        setGeneratingRegexFor(stepIndex);
        addLog(`Generating regex for column "${column}"…`, 'info');
        try {
            const token = localStorage.getItem('auth_token');
            const res = await fetch(`${API_BASE}/api/ai/generate-regex`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: JSON.stringify({ 
                    dataset_name: datasetName, 
                    dataset_path: csvPath || null,
                    column, 
                    intent 
                })
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'Regex generation failed');
            }
            const data = await res.json();
            updateStepParam(stepIndex, 'pattern', data.regex);
            addLog(`Regex generated: ${data.regex}  — ${data.reasoning}`, 'success');
        } catch (e) {
            addLog(`Regex generation error: ${e.message}`, 'error');
        } finally {
            setGeneratingRegexFor(null);
        }
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

    // Bug 1 fix: connectWebSocket now accepts the job_id and sends it
    // immediately in onopen so the server starts forwarding events for
    // this specific job. A new connection is opened per run and closed
    // when the job completes or fails.
    const connectWebSocket = (targetJobId) => {
        // Close any previous connection from a prior run
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        try {
            const ws = new WebSocket('ws://localhost:8000/websocket/crawl_events');
            wsRef.current = ws;

            ws.onopen = () => {
                ws.send(targetJobId);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'ml_job') {
                        if (data.status === 'completed') {
                            setProcessing(false);
                            setResult(data);
                            addLog(`Processing complete — ${data.total_rows} rows, ${data.columns?.length} columns`, 'success');
                            ws.close();
                        } else if (data.status === 'failed') {
                            setProcessing(false);
                            setError(data.error);
                            addLog(`Processing failed: ${data.error}`, 'error');
                            ws.close();
                        } else if (data.status === 'started') {
                            addLog('Pipeline execution started…', 'info');
                        }
                    }
                } catch (_) { }
            };

            ws.onerror = () => addLog('WebSocket connection error', 'error');
            ws.onclose = () => { /* intentional close on completion is fine */ };
        } catch (_) {
            addLog('Cannot connect to WebSocket', 'error');
        }
    };

    const handleDragStart = (idx) => {
        setDraggingIdx(idx);
    };

    const handleDragEnter = (e, targetIdx) => {
        if (draggingIdx === null || draggingIdx === targetIdx) return;
        
        const newPipeline = [...pipeline];
        const draggedItem = newPipeline.splice(draggingIdx, 1)[0];
        newPipeline.splice(targetIdx, 0, draggedItem);
        
        setDraggingIdx(targetIdx);
        setPipeline(newPipeline);
    };

    const handleDragEnd = () => {
        setDraggingIdx(null);
    };

    const handleRun = async () => {
        if (!datasetName.trim() || pipeline.length === 0) {
            setError('Select a dataset and add at least one processing step');
            return;
        }
        setProcessing(true);
        setResult(null);
        setError(null);
        addLog(`Submitting pipeline: ${pipeline.length} steps on "${datasetName}"`, 'info');

        try {
            // Bug 2 fix: encode_categorical with method='one_hot' is remapped
            // to step id 'one_hot' so the registry routes it correctly.
            // method='label' stays as 'label_encode' (via encode_categorical alias).
            const steps = pipeline.map(s => {
                let stepId = s.step;
                const params = Object.fromEntries(
                    Object.entries(s.params).filter(([, v]) => v !== '')
                );

                if (stepId === 'encode_categorical') {
                    stepId = params.method === 'one_hot' ? 'one_hot' : 'label_encode';
                    // method param is a UI-only concern — don't send it to backend
                    delete params.method;
                }

                return { step: stepId, params };
            });

            const token = localStorage.getItem('auth_token');
            const response = await fetch(`${API_BASE}/api/process`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ dataset_name: datasetName, steps })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || 'Processing request failed');
            }

            const data = await response.json();
            setJobId(data.job_id);
            addLog(`Job submitted: ${data.job_id}`, 'success');

            // Bug 1 fix: open WS after we have the job_id so we can
            // send it immediately in onopen
            connectWebSocket(data.job_id);

        } catch (err) {
            setProcessing(false);
            setError(err.message);
            addLog(`Error: ${err.message}`, 'error');
        }
    };
 
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
                            {availableColumns.length > 0 && (
                                <span className="badge badge-neutral">
                                    <Columns size={10} style={{ marginRight: 4 }} />
                                    {availableColumns.length} columns
                                </span>
                            )}
                        </div>
                        <div className="card-body">
                            <CsvDatasetPicker
                                value={csvPath}
                                onChange={(path, name) => {
                                    setCsvPath(path);
                                    setDatasetName(name);
                                    setAvailableColumns([]);
                                    fetchColumns(path);
                                }}
                                label="Source Dataset"
                            />
                            {availableColumns.length > 0 && (
                                <div style={{ marginTop: 'var(--space-sm)', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {availableColumns.map(col => (
                                        <span key={col} className="badge badge-neutral mono" style={{ fontSize: 10 }}>
                                            {col}
                                        </span>
                                    ))}
                                </div>
                            )}
                            <div className="form-hint" style={{ marginTop: 6 }}>
                                Only datasets saved via "Save to ML Datasets" appear here
                            </div>
                        </div>
                    </div>

                    {/* Pipeline Builder */}
                    <div className="card">
                        <div className="card-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span className="card-title">Pipeline Steps</span>
                                <span className="badge badge-neutral">{pipeline.length}</span>
                            </div>
                            
                            <div style={{ display: 'flex', gap: 8 }}>
                                <input 
                                    className="form-input"
                                    placeholder="Enter ML goal (e.g. 'classify spam', 'predict prices') for better suggestions…"
                                    value={aiGoal}
                                    onChange={e => setAiGoal(e.target.value)}
                                    style={{ fontSize: 12, padding: '6px 10px' }}
                                />
                                <button
                                    className="btn btn-secondary"
                                    onClick={handleAutoSuggest}
                                    disabled={isSuggesting || !datasetName}
                                    style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '6px 12px' }}
                                >
                                    {isSuggesting
                                        ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Thinking…</>
                                        : <><Sparkles size={14} /> Auto-Suggest</>}
                                </button>
                            </div>
                        </div>

                        {aiSummary && (
                            <div style={{ 
                                padding: '12px 15px', 
                                background: 'var(--bg-secondary)', 
                                borderBottom: '1px solid var(--border-light)',
                                position: 'relative'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: 'var(--color-primary)', fontWeight: 600, fontSize: 12 }}>
                                    <Sparkles size={14} />
                                    AI Strategy Summary
                                </div>
                                <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)', marginBottom: 10 }}>
                                    {aiSummary}
                                </p>
                                {suggestedModels.length > 0 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Recommended Models:</span>
                                        {suggestedModels.map(m => (
                                            <span key={m} className="badge badge-primary" style={{ fontSize: 10 }}>{m}</span>
                                        ))}
                                    </div>
                                )}
                                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                                    <button className="btn btn-primary btn-sm" onClick={approveAllDrafts} style={{ fontSize: 11 }}>Approve All</button>
                                    <button className="btn btn-secondary btn-sm" onClick={dismissAllDrafts} style={{ fontSize: 11 }}>Dismiss Suggestions</button>
                                </div>
                            </div>
                        )}

                        {suggestError && (
                            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--color-error)', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)' }}>
                                {suggestError}
                            </div>
                        )}
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
                                    const isDragging = draggingIdx === idx;
                                    return (
                                        <div 
                                            key={idx} 
                                            draggable
                                            onDragStart={() => handleDragStart(idx)}
                                            onDragEnter={(e) => handleDragEnter(e, idx)}
                                            onDragEnd={handleDragEnd}
                                            onDragOver={(e) => e.preventDefault()}
                                            className={`pipeline-step ${step.draft ? 'draft' : ''} ${isDragging ? 'dragging' : ''}`} 
                                            style={{
                                                ...(step.draft ? { borderLeft: '3px solid var(--color-primary)', background: 'rgba(59, 130, 246, 0.03)' } : {}),
                                                ...(isDragging ? { 
                                                    opacity: 0.3, 
                                                    transform: 'scale(0.98)', 
                                                    background: 'var(--bg-secondary)',
                                                    border: '1px dashed var(--color-primary)'
                                                } : {}),
                                                transition: 'transform 0.2s ease, opacity 0.2s ease',
                                                cursor: 'grab'
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', marginRight: 10, color: 'var(--text-muted)' }}>
                                                <GripVertical size={16} />
                                            </div>
                                            <div className="pipeline-step-number">{idx + 1}</div>
                                            <div className="pipeline-step-content">
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                                                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                                                        {step.label}
                                                        {step.draft && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>[Draft]</span>}
                                                    </div>
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
                                                        ) : p.type === 'singlecolumn' ? (
                                                            <select
                                                                className="form-select"
                                                                value={step.params[p.key]}
                                                                onChange={e => updateStepParam(idx, p.key, e.target.value)}
                                                                style={{ padding: '4px 8px', fontSize: 12 }}
                                                            >
                                                                <option value="">Select column…</option>
                                                                {availableColumns.map(col => (
                                                                    <option key={col} value={col}>{col}</option>
                                                                ))}
                                                            </select>
                                                        ) : p.type === 'multicolumn' ? (
                                                            <ColumnPicker
                                                                value={step.params[p.key]}
                                                                onChange={val => updateStepParam(idx, p.key, val)}
                                                                availableColumns={availableColumns}
                                                            />
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
                                                {/* AI Reasoning hint */}
                                                {step.aiGenerated && step.aiReasoning && (
                                                    <div style={{
                                                        marginTop: 6, padding: '5px 8px', borderRadius: 6,
                                                        background: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
                                                        border: '1px solid color-mix(in srgb, var(--color-success) 25%, transparent)',
                                                        fontSize: 11, color: 'var(--color-success)', display: 'flex', gap: 5
                                                    }}>
                                                        <Sparkles size={11} style={{ flexShrink: 0, marginTop: 1 }} />
                                                        {step.aiReasoning}
                                                    </div>
                                                )}
                                                {/* AI Regex Builder — only for regex_extract steps */}
                                                {step.step === 'regex_extract' && (
                                                    <div style={{
                                                        marginTop: 8, padding: '8px 10px', borderRadius: 6,
                                                        background: 'var(--bg-secondary)',
                                                        border: '1px dashed var(--border-light)'
                                                    }}>
                                                        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 5, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            <Sparkles size={11} />
                                                            AI Regex Builder
                                                        </div>
                                                        <input
                                                            className="form-input"
                                                            placeholder="Describe what to extract (e.g. 'get the price number')…"
                                                            value={regexIntents[idx] || ''}
                                                            onChange={e => setRegexIntents(prev => ({ ...prev, [idx]: e.target.value }))}
                                                            style={{ fontSize: 12, padding: '4px 8px', marginBottom: 6 }}
                                                        />
                                                        <button
                                                            className="btn btn-secondary btn-sm"
                                                            onClick={() => handleGenerateRegex(idx)}
                                                            disabled={generatingRegexFor === idx || !step.params.column}
                                                            style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                                                        >
                                                            {generatingRegexFor === idx
                                                                ? <><Loader size={11} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
                                                                : <><Sparkles size={11} /> Generate Regex</>}
                                                        </button>
                                                    </div>
                                                )}
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

                    {error && (
                        <div className="card" style={{ marginTop: 'var(--space-md)' }}>
                            <div className="card-body flex-row" style={{ color: 'var(--color-error)' }}>
                                <AlertCircle size={16} />
                                <span style={{ fontSize: 13 }}>{error}</span>
                            </div>
                        </div>
                    )}

                    {result && (
                        <div className="card" style={{ marginTop: 'var(--space-md)', overflow: 'hidden' }}>
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
                            <button className="btn btn-secondary btn-sm" onClick={() => setLogs([])}>
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