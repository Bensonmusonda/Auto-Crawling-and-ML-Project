import React, { useState, useEffect, useCallback } from 'react';
import Papa from 'papaparse';
import {
    Database, Download, ChevronLeft, ChevronRight,
    Search, Table, AlertCircle, Upload, CheckCircle
} from 'lucide-react';

const API_BASE = 'http://localhost:8000';
const ROWS_PER_PAGE = 25;

export default function DatasetExplorer() {
    const [datasets, setDatasets] = useState([]);
    const [selectedDataset, setSelectedDataset] = useState(null);
    const [tableData, setTableData] = useState({ columns: [], rows: [] });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [page, setPage] = useState(0);
    const [searchTerm, setSearchTerm] = useState('');
    const [uploadMode, setUploadMode] = useState(false);
    const [uploadName, setUploadName] = useState('');
    const [uploadCsv, setUploadCsv] = useState('');
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    useEffect(() => {
        fetchDatasets();
    }, []);

    const fetchDatasets = async () => {
        try {
            const response = await fetch(`${API_BASE}/api/datasets/list`);
            if (!response.ok) throw new Error('Failed to fetch datasets');
            const data = await response.json();
            setDatasets(data);
        } catch (err) {
            setError(err.message);
        }
    };

    const selectDataset = useCallback((datasetName) => {
        setError(null);
        setPage(0);
        setTableData({ columns: [], rows: [] });
        setSelectedDataset(datasetName);
    }, []);

    const saveToMLDatasets = async () => {
        if (!selectedDataset) return;
        setSaving(true);
        setSaveSuccess(false);
        try {
            const response = await fetch(
                `${API_BASE}/api/datasets/save-csv?dataset_name=${encodeURIComponent(selectedDataset)}`,
                { method: 'POST' }
            );
            if (!response.ok) throw new Error('Save failed');
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const generateAndLoadCSV = async () => {
        if (!selectedDataset) return;
        setLoading(true);
        setError(null);
        setPage(0);

        try {
            const response = await fetch(
                `${API_BASE}/api/generate/csv?dataset_name=${encodeURIComponent(selectedDataset)}`
            );
            if (!response.ok) throw new Error('Dataset not found or empty');

            const csvText = await response.text();
            const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

            setTableData({
                columns: parsed.meta.fields || [],
                rows: parsed.data || [],
            });
        } catch (err) {
            setError(err.message);
            setTableData({ columns: [], rows: [] });
        } finally {
            setLoading(false);
        }
    };

    const handleUpload = async () => {
        if (!uploadName.trim() || !uploadCsv.trim()) return;
        setUploading(true);
        try {
            const response = await fetch(`${API_BASE}/api/upload_temp_csv`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dataset_name: uploadName, csv: uploadCsv }),
            });
            if (!response.ok) throw new Error('Upload failed');
            setUploadMode(false);
            setUploadName('');
            setUploadCsv('');
            fetchDatasets();
            selectDataset(uploadName);
        } catch (err) {
            setError(err.message);
        } finally {
            setUploading(false);
        }
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            setUploadCsv(event.target.result);
            if (!uploadName) setUploadName(file.name.replace(/\.csv$/i, ''));
        };
        reader.readAsText(file);
    };

    const downloadCsv = () => {
        if (!selectedDataset) return;
        window.open(
            `${API_BASE}/api/generate/csv?dataset_name=${encodeURIComponent(selectedDataset)}`,
            '_blank'
        );
    };

    const totalPages = Math.ceil(tableData.rows.length / ROWS_PER_PAGE);
    const paginatedRows = tableData.rows.slice(
        page * ROWS_PER_PAGE,
        (page + 1) * ROWS_PER_PAGE
    );

    const filteredDatasets = datasets.filter(d =>
        (d.source_dataset || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const inferType = (columnName) => {
        const sample = tableData.rows.slice(0, 20);
        const values = sample.map(r => r[columnName]).filter(v => v !== '' && v != null);
        if (values.length === 0) return 'empty';
        const allNumeric = values.every(v => !isNaN(Number(v)));
        if (allNumeric) return 'numeric';
        const allBool = values.every(v => ['true', 'false', '0', '1'].includes(String(v).toLowerCase()));
        if (allBool) return 'boolean';
        return 'string';
    };

    return (
        <div className="page-container">
            <div className="page-header flex-between">
                <div>
                    <h1 className="page-title">Dataset Explorer</h1>
                    <p className="page-description">Browse, preview, and export scraped datasets</p>
                </div>
                <div className="flex-row">
                    <button className="btn btn-secondary" onClick={() => setUploadMode(!uploadMode)}>
                        <Upload /> Upload CSV
                    </button>
                </div>
            </div>

            {/* Upload Panel */}
            {uploadMode && (
                <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
                    <div className="card-header">
                        <span className="card-title">Upload Dataset</span>
                    </div>
                    <div className="card-body">
                        <div className="grid-2">
                            <div className="form-group">
                                <label className="form-label">Dataset Name</label>
                                <input
                                    className="form-input"
                                    value={uploadName}
                                    onChange={e => setUploadName(e.target.value)}
                                    placeholder="my_dataset"
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">CSV File</label>
                                <input
                                    type="file"
                                    accept=".csv"
                                    onChange={handleFileSelect}
                                    className="form-input"
                                />
                            </div>
                        </div>
                        {uploadCsv && (
                            <div className="form-group">
                                <label className="form-label">Preview</label>
                                <textarea
                                    className="form-input mono"
                                    rows={4}
                                    value={uploadCsv.substring(0, 500)}
                                    readOnly
                                    style={{ resize: 'none' }}
                                />
                            </div>
                        )}
                        <button
                            className="btn btn-primary"
                            onClick={handleUpload}
                            disabled={uploading || !uploadName || !uploadCsv}
                        >
                            {uploading ? <><span className="spinner" /> Uploading...</> : 'Upload'}
                        </button>
                    </div>
                </div>
            )}

            <div className="two-col">
                {/* Dataset List */}
                <div className="card">
                    <div className="card-header">
                        <span className="card-title">Datasets</span>
                        <span className="badge badge-neutral">{datasets.length}</span>
                    </div>
                    <div style={{ padding: 'var(--space-sm)' }}>
                        <div style={{ position: 'relative' }}>
                            <Search
                                size={14}
                                style={{
                                    position: 'absolute', left: 10, top: '50%',
                                    transform: 'translateY(-50%)', color: 'var(--text-muted)'
                                }}
                            />
                            <input
                                className="form-input"
                                placeholder="Search datasets..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                style={{ paddingLeft: 30 }}
                            />
                        </div>
                    </div>
                    <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                        {filteredDatasets.length === 0 ? (
                            <div className="empty-state">
                                <Database />
                                <div className="empty-state-title">No datasets found</div>
                                <div className="empty-state-text">
                                    Crawl a website or upload a CSV to get started
                                </div>
                            </div>
                        ) : (
                            filteredDatasets.map((d, i) => (
                                <div
                                    key={i}
                                    className={`dataset-list-item ${selectedDataset === d.source_dataset ? 'active' : ''}`}
                                    onClick={() => selectDataset(d.source_dataset)}
                                >
                                    <div>
                                        <div className="dataset-name">{d.source_dataset}</div>
                                        <div className="dataset-meta">
                                            {d.row_count} rows
                                            {d.processed_at && (
                                                <> &middot; {new Date(d.processed_at).toLocaleDateString()}</>
                                            )}
                                        </div>
                                    </div>
                                    <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Data Preview */}
                <div>
                    {error && (
                        <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
                            <div className="card-body flex-row" style={{ color: 'var(--color-error)' }}>
                                <AlertCircle size={16} />
                                <span style={{ fontSize: 13 }}>{error}</span>
                            </div>
                        </div>
                    )}

                    {!selectedDataset && !loading && (
                        <div className="card">
                            <div className="card-body empty-state">
                                <Table />
                                <div className="empty-state-title">Select a dataset</div>
                                <div className="empty-state-text">
                                    Choose a dataset from the list to preview its contents
                                </div>
                            </div>
                        </div>
                    )}

                    {selectedDataset && !loading && tableData.columns.length === 0 && (
                        <div className="card">
                            <div className="card-body empty-state">
                                <Table />
                                <div className="empty-state-title">{selectedDataset}</div>
                                <div className="empty-state-text">
                                    Click below to generate and view the CSV data for this dataset. This might take a few moments for large datasets.
                                </div>
                                <button className="btn btn-primary" style={{ marginTop: 'var(--space-md)' }} onClick={generateAndLoadCSV}>
                                    <Database size={16} /> Generate & View CSV
                                </button>
                            </div>
                        </div>
                    )}

                    {loading && (
                        <div className="card">
                            <div className="card-body empty-state">
                                <span className="spinner" style={{ width: 24, height: 24 }} />
                                <div className="empty-state-title" style={{ marginTop: 12 }}>
                                    Loading dataset...
                                </div>
                            </div>
                        </div>
                    )}

                    {selectedDataset && !loading && tableData.columns.length > 0 && (
                        <>
                            {/* Stats */}
                            <div className="grid-4" style={{ marginBottom: 'var(--space-md)' }}>
                                <div className="stat-card">
                                    <div className="stat-label">Rows</div>
                                    <div className="stat-value">{tableData.rows.length.toLocaleString()}</div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-label">Columns</div>
                                    <div className="stat-value">{tableData.columns.length}</div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-label">Numeric</div>
                                    <div className="stat-value info">
                                        {tableData.columns.filter(c => inferType(c) === 'numeric').length}
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-label">Categorical</div>
                                    <div className="stat-value warning">
                                        {tableData.columns.filter(c => inferType(c) === 'string').length}
                                    </div>
                                </div>
                            </div>

                            {/* Table */}
                            <div className="card">
                                <div className="card-header">
                                    <span className="card-title">{selectedDataset}</span>
                                    <div className="flex-row">
                                        <button className="btn btn-secondary btn-sm" onClick={downloadCsv}>
                                            <Download size={12} /> Export CSV
                                        </button>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={saveToMLDatasets}
                                            disabled={saving}
                                            title="Save to /app/datasets/ for use in Processing & ML Training"
                                        >
                                            {saving ? <span className="spinner" /> : saveSuccess ? <CheckCircle size={12} style={{ color: 'var(--color-success)' }} /> : <Database size={12} />}
                                            {saveSuccess ? 'Saved!' : 'Save to ML Datasets'}
                                        </button>
                                    </div>
                                </div>
                                <div className="data-table-wrapper" style={{ maxHeight: 440 }}>
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th style={{ width: 40 }}>#</th>
                                                {tableData.columns.map(col => (
                                                    <th key={col}>
                                                        {col}
                                                        <div style={{
                                                            fontWeight: 400, fontSize: 10,
                                                            color: 'var(--text-muted)', textTransform: 'none',
                                                            letterSpacing: 0
                                                        }}>
                                                            {inferType(col)}
                                                        </div>
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {paginatedRows.map((row, idx) => (
                                                <tr key={idx}>
                                                    <td className="mono" style={{ color: 'var(--text-muted)' }}>
                                                        {page * ROWS_PER_PAGE + idx + 1}
                                                    </td>
                                                    {tableData.columns.map(col => (
                                                        <td key={col} title={row[col]}>
                                                            {row[col] === '' || row[col] == null
                                                                ? <span style={{ color: 'var(--text-muted)' }}>null</span>
                                                                : row[col]
                                                            }
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Pagination */}
                                {totalPages > 1 && (
                                    <div className="pagination">
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setPage(p => Math.max(0, p - 1))}
                                            disabled={page === 0}
                                        >
                                            <ChevronLeft size={12} />
                                        </button>
                                        <span className="pagination-info">
                                            Page {page + 1} of {totalPages}
                                        </span>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                            disabled={page === totalPages - 1}
                                        >
                                            <ChevronRight size={12} />
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Column Summary */}
                            <div className="card" style={{ marginTop: 'var(--space-md)' }}>
                                <div className="card-header">
                                    <span className="card-title">Column Summary</span>
                                </div>
                                <div className="data-table-wrapper">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Column</th>
                                                <th>Type</th>
                                                <th>Non-null</th>
                                                <th>Unique</th>
                                                <th>Sample</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {tableData.columns.map(col => {
                                                const values = tableData.rows.map(r => r[col]).filter(v => v !== '' && v != null);
                                                const unique = new Set(values).size;
                                                return (
                                                    <tr key={col}>
                                                        <td style={{ fontWeight: 500 }}>{col}</td>
                                                        <td>
                                                            <span className={`badge ${inferType(col) === 'numeric' ? 'badge-info' :
                                                                inferType(col) === 'boolean' ? 'badge-warning' :
                                                                    'badge-neutral'
                                                                }`}>
                                                                {inferType(col)}
                                                            </span>
                                                        </td>
                                                        <td className="mono">{values.length} / {tableData.rows.length}</td>
                                                        <td className="mono">{unique}</td>
                                                        <td className="mono" style={{ color: 'var(--text-tertiary)' }}>
                                                            {values[0] !== undefined ? String(values[0]).substring(0, 30) : '—'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
