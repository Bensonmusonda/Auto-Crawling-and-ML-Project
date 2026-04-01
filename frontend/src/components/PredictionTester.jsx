import React, { useState } from 'react';
import { Play, AlertCircle, CheckCircle } from 'lucide-react';

const API_BASE = 'http://localhost:8000';

/**
 * PredictionTester
 *
 * Drop this component into the MLTraining results view, below the
 * hyperparameters card. Pass the detailModel object as a prop.
 *
 * Props:
 *   model — the detailModel object from MLTraining state
 *             (needs: job_id, feature_names, task_type, target_column)
 */
export default function PredictionTester({ model }) {
    const [values, setValues] = useState(() => {
        const init = {};
        (model.feature_names || []).forEach(f => { init[f] = ''; });
        return init;
    });
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    if (!model.feature_names || model.feature_names.length === 0) {
        return null;
    }

    const handleChange = (feature, value) => {
        setValues(prev => ({ ...prev, [feature]: value }));
        setResult(null);
        setError(null);
    };

    const handlePredict = async () => {
        // Convert all values to numbers where possible,
        // leave as string otherwise (endpoint handles coercion)
        const payload = {};
        for (const [k, v] of Object.entries(values)) {
            const num = Number(v);
            payload[k] = v === '' ? 0 : isNaN(num) ? v : num;
        }

        setLoading(true);
        setResult(null);
        setError(null);

        try {
            const res = await fetch(
                `${API_BASE}/api/ml-training/predict/${model.job_id}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }
            );
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.detail || `HTTP ${res.status}`);
            }
            setResult(data);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };


    return (
        <div className="card" style={{ marginTop: 'var(--space-md)' }}>
            <div className="card-header">
                <span className="card-title">Test prediction</span>
                <span className="badge badge-neutral" style={{ textTransform: 'capitalize' }}>
                    {model.task_type} · {model.target_column}
                </span>
            </div>
            <div className="card-body">
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 'var(--space-md)' }}>
                    Enter feature values to get a prediction from this model.
                    Blank fields default to 0.
                </p>

                {/* Feature inputs — two column grid */}
                <div className="grid-2" style={{ marginBottom: 'var(--space-md)' }}>
                    {(model.feature_names || []).map(feature => (
                        <div key={feature} className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label" style={{ fontSize: 10 }}>
                                {feature}
                            </label>
                            <input
                                className="form-input"
                                type="text"
                                step="any"
                                placeholder="0"
                                value={values[feature]}
                                onChange={e => handleChange(feature, e.target.value)}
                                style={{ padding: '6px 10px', fontSize: 13 }}
                            />
                        </div>
                    ))}
                </div>

                <button
                    className="btn btn-primary"
                    onClick={handlePredict}
                    disabled={loading}
                    style={{ minWidth: 140 }}
                >
                    {loading
                        ? <><span className="spinner" /> Predicting…</>
                        : <><Play size={13} /> Predict</>
                    }
                </button>

                {/* Result */}
                {result && (
                    <div className="card" style={{
                        marginTop: 'var(--space-md)',
                        border: '1px solid var(--color-success)',
                    }}>
                        <div className="card-body" style={{ padding: 'var(--space-md)' }}>
                            <div className="flex-row" style={{ marginBottom: 'var(--space-sm)' }}>
                                <CheckCircle size={14} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                    Predicted {result.target_column}
                                </span>
                            </div>
                            <div style={{
                                fontSize: 28,
                                fontWeight: 700,
                                color: 'var(--text-primary)',
                                letterSpacing: '-0.02em',
                                fontFamily: 'var(--font-mono)',
                            }}>
                                {result.prediction_display}
                            </div>
                            {result.task_type === 'regression' && (
                                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                                    raw value: {result.prediction}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div className="card" style={{
                        marginTop: 'var(--space-md)',
                        border: '1px solid var(--color-error)',
                    }}>
                        <div className="card-body flex-row" style={{
                            padding: 'var(--space-md)',
                            color: 'var(--color-error)',
                        }}>
                            <AlertCircle size={14} style={{ flexShrink: 0 }} />
                            <span style={{ fontSize: 12 }}>{error}</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}