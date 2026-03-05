import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';

const API_BASE = 'http://localhost:8000';

export default function CsvDatasetPicker({ value, onChange, label = "Dataset" }) {
    const [datasets, setDatasets] = useState([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchDatasets();
    }, []);

    const fetchDatasets = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/datasets/csv-list`);
            const data = await res.json();
            setDatasets(data);
        } catch (e) {
            console.error('Failed to fetch CSV datasets', e);
        } finally {
            setLoading(false);
        }
    };

    const filtered = datasets.filter(d =>
        d.name.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="form-group" style={{ marginBottom: 0 }}>
            <div className="flex-between" style={{ marginBottom: 4 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>{label}</label>
                <button
                    className="btn btn-secondary btn-sm"
                    onClick={fetchDatasets}
                    style={{ fontSize: 10, padding: '2px 8px' }}
                >
                    Refresh
                </button>
            </div>

            {/* Search */}
            <div style={{ position: 'relative', marginBottom: 6 }}>
                <Search size={12} style={{
                    position: 'absolute', left: 8, top: '50%',
                    transform: 'translateY(-50%)', color: 'var(--text-muted)'
                }} />
                <input
                    className="form-input"
                    placeholder="Search datasets..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ paddingLeft: 26, fontSize: 12 }}
                />
            </div>

            {/* Dropdown list */}
            <div style={{
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-md)',
                maxHeight: 180,
                overflowY: 'auto',
                background: 'var(--bg-primary)',
            }}>
                {loading ? (
                    <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                        <span className="spinner" style={{ width: 12, height: 12 }} />
                    </div>
                ) : filtered.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                        {datasets.length === 0
                            ? 'No saved CSVs yet — use "Save to ML Datasets" in Dataset Explorer'
                            : 'No matches'}
                    </div>
                ) : (
                    filtered.map(d => (
                        <div
                            key={d.path}
                            onClick={() => onChange(d.path, d.name)}
                            style={{
                                padding: '8px 12px',
                                cursor: 'pointer',
                                borderBottom: '1px solid var(--border-light)',
                                background: value === d.path ? 'var(--bg-tertiary)' : undefined,
                                fontSize: 13,
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                            onMouseLeave={e => e.currentTarget.style.background = value === d.path ? 'var(--bg-tertiary)' : ''}
                        >
                            <span style={{ fontWeight: value === d.path ? 600 : 400 }}>{d.name}</span>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{d.size_kb} KB</span>
                        </div>
                    ))
                )}
            </div>

            {value && (
                <div className="form-hint" style={{ marginTop: 4 }}>
                    Selected: <span className="mono">{value}</span>
                </div>
            )}
        </div>
    );
}