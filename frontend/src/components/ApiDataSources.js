import React, { useState, useCallback, useEffect } from 'react';
import {
  Globe, Plus, Trash2, Play, Database, CheckCircle,
  AlertCircle, ChevronRight, ChevronDown, Sparkles, Settings, Key, Lock,
  BookmarkPlus, Clock, RefreshCw
} from 'lucide-react';

const API_BASE = 'http://localhost:8000';

const QUICK_STARTS = [
  {
    name: 'CoinGecko Crypto',
    url: 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50',
    path: '', dataset: 'crypto_top_50', method: 'GET',
  },
  {
    name: 'Open-Meteo Weather',
    url: 'https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&hourly=temperature_2m',
    path: 'hourly', dataset: 'berlin_hourly_temp', method: 'GET',
  },
  {
    name: 'REST Countries',
    url: 'https://restcountries.com/v3.1/all',
    path: '', dataset: 'world_countries', method: 'GET',
  },
];

const PAGINATION_MODES = [
  { value: 'none',   label: 'None (single request)' },
  { value: 'page',   label: 'Page number (?page=1&limit=100)' },
  { value: 'offset', label: 'Offset (?offset=0&limit=100)' },
  { value: 'cursor', label: 'Cursor / token (next_cursor in response)' },
  { value: 'link',   label: 'Link header (rel="next") — auto' },
];

// ─── Step indicator ────────────────────────────────────────────────────────────

const STEPS = ['Configure', 'Explore', 'Extract', 'Save'];

function StepIndicator({ current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 'var(--space-lg)' }}>
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={label}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 600,
                background: done ? 'var(--color-success)' : active ? 'var(--color-primary)' : 'var(--bg-secondary)',
                color: (done || active) ? '#fff' : 'var(--text-muted)',
                border: active ? '2px solid var(--color-primary)' : 'none',
                transition: 'all 0.2s',
              }}>
                {done ? <CheckCircle size={14} /> : i + 1}
              </div>
              <span style={{
                fontSize: 11, fontWeight: active ? 600 : 400, whiteSpace: 'nowrap',
                color: active ? 'var(--color-primary)' : done ? 'var(--color-success)' : 'var(--text-muted)',
              }}>{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{
                flex: 1, height: 2, margin: '0 4px', marginBottom: 18,
                background: done ? 'var(--color-success)' : 'var(--border-light)',
                transition: 'background 0.3s',
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Shape detection (mirrors backend is_columnar) ─────────────────────────────

function isColumnar(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const values = Object.values(data);
  if (!values.length) return false;
  if (!values.every(v => Array.isArray(v))) return false;
  const len = values[0].length;
  return values.every(v => v.length === len);
}

function detectDataShape(data) {
  if (Array.isArray(data)) return 'array-of-objects';
  if (isColumnar(data)) return 'columnar';
  if (data && typeof data === 'object') return 'single-object';
  return 'unknown';
}

// ─── Client-side normalizer ────────────────────────────────────────────────────

function flattenRecord(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenRecord(v, key));
    } else {
      out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
    }
  }
  return out;
}

function normalizeToRows(data) {
  // Shape B: object of parallel arrays → transpose into rows
  if (isColumnar(data)) {
    const keys = Object.keys(data);
    const len = data[keys[0]].length;
    return Array.from({ length: len }, (_, i) => {
      const row = {};
      keys.forEach(k => { row[k] = data[k][i]; });
      return row;
    });
  }
  // Shape A: array of objects → flatten each
  if (Array.isArray(data)) {
    return data.map(item =>
      typeof item === 'object' && item !== null ? flattenRecord(item) : { value: item }
    );
  }
  // Single object
  if (data && typeof data === 'object') return [flattenRecord(data)];
  return [];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function resolvePath(data, path) {
  if (!path) return data;
  try { return path.split('.').reduce((acc, k) => acc[k], data); }
  catch { return null; }
}

function isSelectableTarget(data) {
  return Array.isArray(data) || isColumnar(data) || (data && typeof data === 'object');
}

function deriveStep(previewData, availableColumns, success) {
  if (success) return 4;
  if (!previewData) return 0;
  if (availableColumns.length > 0) return 2;
  return 1;
}

// ─── JSON tree explorer ────────────────────────────────────────────────────────

function JsonNode({ data, path, depth, onSelectPath, selectedPath }) {
  const [expanded, setExpanded] = useState(depth < 2);

  const isArr = Array.isArray(data);
  const isObj = data !== null && typeof data === 'object' && !isArr;
  const isPrim = !isArr && !isObj;

  if (isPrim) {
    return (
      <span style={{ color: typeof data === 'string' ? 'var(--color-success)' : 'var(--color-primary)', fontSize: 12, fontFamily: 'monospace' }}>
        {JSON.stringify(data)}
      </span>
    );
  }

  const isSelected = path === selectedPath;
  const columnar = isObj && isColumnar(data);
  const selectable = isArr || columnar || isObj;

  const shapeLabel = isArr
    ? `[${data.length} items]`
    : columnar
      ? `{columnar · ${Object.keys(data).length} cols × ${Object.values(data)[0].length} rows}`
      : `{${Object.keys(data).length} keys}`;

  const badgePrimary = isArr || columnar;

  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 16 }}>
      <div
        onClick={() => {
          setExpanded(e => !e);
          if (selectable) onSelectPath(path);
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
          background: isSelected ? 'rgba(59,130,246,0.12)' : 'transparent',
          border: isSelected ? '1px solid var(--color-primary)' : '1px solid transparent',
          transition: 'background 0.15s',
        }}
      >
        <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>

        {path && (
          <span style={{ fontSize: 12, fontWeight: 600, fontFamily: 'monospace', color: isSelected ? 'var(--color-primary)' : 'var(--text-secondary)' }}>
            {path.includes('.') ? path.split('.').pop() : path}
          </span>
        )}
        {path && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>:</span>}

        <span style={{
          fontSize: 10, padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace',
          fontWeight: badgePrimary ? 600 : 400,
          background: badgePrimary ? 'var(--color-primary-bg, #eff6ff)' : 'var(--bg-secondary)',
          color: badgePrimary ? 'var(--color-primary)' : 'var(--text-muted)',
        }}>
          {shapeLabel}
        </span>

        {selectable && !isSelected && (
          <span style={{ fontSize: 10, color: 'var(--color-primary)', opacity: 0.7 }}>← select</span>
        )}
        {isSelected && (
          <span style={{ fontSize: 10, color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 2 }}>
            <CheckCircle size={10} /> selected
          </span>
        )}
      </div>

      {expanded && (
        <div style={{ marginLeft: 8, borderLeft: '1px solid var(--border-light)', paddingLeft: 4 }}>
          {isArr ? (
            <>
              {data.slice(0, 2).map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 4, paddingTop: 2 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', minWidth: 20 }}>[{i}]</span>
                  <JsonNode data={item} path={path ? `${path}.${i}` : String(i)} depth={depth + 1} onSelectPath={onSelectPath} selectedPath={selectedPath} />
                </div>
              ))}
              {data.length > 2 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '2px 0 2px 20px', fontStyle: 'italic' }}>
                  … {data.length - 2} more items
                </div>
              )}
            </>
          ) : (
            // Object keys — for columnar, show the array lengths as a hint
            Object.keys(data).map(key => (
              <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 4, paddingTop: 2 }}>
                {typeof data[key] === 'object' && data[key] !== null ? (
                  <JsonNode data={data[key]} path={path ? `${path}.${key}` : key} depth={depth + 1} onSelectPath={onSelectPath} selectedPath={selectedPath} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 20 }}>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{key}:</span>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', color: typeof data[key] === 'string' ? 'var(--color-success)' : 'var(--color-primary)' }}>
                      {JSON.stringify(data[key])}
                    </span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Auth template builder ─────────────────────────────────────────────────────

function AuthTemplateBar({ onApply }) {
  const [template, setTemplate] = useState('none');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyName, setApiKeyName] = useState('X-API-Key');
  const [token, setToken] = useState('');
  const [basicUser, setBasicUser] = useState('');
  const [basicPass, setBasicPass] = useState('');

  const apply = () => {
    if (template === 'apikey' && apiKey) {
      onApply([{ key: apiKeyName || 'X-API-Key', value: apiKey }]);
    } else if (template === 'bearer' && token) {
      onApply([{ key: 'Authorization', value: `Bearer ${token}` }]);
    } else if (template === 'basic' && basicUser) {
      const encoded = btoa(`${basicUser}:${basicPass}`);
      onApply([{ key: 'Authorization', value: `Basic ${encoded}` }]);
    }
  };

  return (
    <div style={{ padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 6, marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Key size={12} /> Auth template
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <select
          className="form-select"
          style={{ fontSize: 12, padding: '4px 8px', flex: '0 0 auto', minWidth: 160 }}
          value={template}
          onChange={e => setTemplate(e.target.value)}
        >
          <option value="none">— select template —</option>
          <option value="apikey">API Key</option>
          <option value="bearer">Bearer token</option>
          <option value="basic">Basic auth</option>
        </select>

        {template === 'apikey' && (
          <>
            <input className="form-input" placeholder="Header name" value={apiKeyName}
              onChange={e => setApiKeyName(e.target.value)} style={{ fontSize: 12, width: 130 }} />
            <input className="form-input" placeholder="Key value" value={apiKey}
              onChange={e => setApiKey(e.target.value)} style={{ fontSize: 12, flex: 1 }} />
          </>
        )}
        {template === 'bearer' && (
          <input className="form-input" placeholder="Token" value={token}
            onChange={e => setToken(e.target.value)} style={{ fontSize: 12, flex: 1 }} />
        )}
        {template === 'basic' && (
          <>
            <input className="form-input" placeholder="Username" value={basicUser}
              onChange={e => setBasicUser(e.target.value)} style={{ fontSize: 12, flex: 1 }} />
            <input className="form-input" placeholder="Password" type="password" value={basicPass}
              onChange={e => setBasicPass(e.target.value)} style={{ fontSize: 12, flex: 1 }} />
          </>
        )}
        {template !== 'none' && (
          <button className="btn btn-secondary btn-sm" onClick={apply} style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
            <Lock size={11} /> Apply to headers
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Pagination config panel ───────────────────────────────────────────────────

function PaginationPanel({ config, onChange }) {
  const set = (key, val) => onChange({ ...config, [key]: val });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Mode</label>
        <select className="form-select" style={{ fontSize: 12 }} value={config.mode} onChange={e => set('mode', e.target.value)}>
          {PAGINATION_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      {config.mode !== 'link' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0, minWidth: 100 }}>
            <label className="form-label" style={{ fontSize: 11 }}>Page size</label>
            <input 
              className="form-input" 
              type="number" 
              style={{ fontSize: 12 }} 
              value={config.page_size === '' ? '' : config.page_size}
              onChange={e => set('page_size', e.target.value === '' ? '' : parseInt(e.target.value, 10))} 
            />
          </div>
          <div className="form-group" style={{ flex: 1, marginBottom: 0, minWidth: 100 }}>
            <label className="form-label" style={{ fontSize: 11 }}>Max rows (cap)</label>
            <input className="form-input" type="number" placeholder="10000" style={{ fontSize: 12 }} value={config.max_rows || ''}
              onChange={e => set('max_rows', parseInt(e.target.value, 10) || null)} />
          </div>
        </div>
      )}

      {config.mode === 'page' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: 11 }}>Page param name</label>
            <input className="form-input" style={{ fontSize: 12 }} value={config.page_param}
              onChange={e => set('page_param', e.target.value)} placeholder="page" />
          </div>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: 11 }}>Start page</label>
            <input className="form-input" type="number" style={{ fontSize: 12 }} value={config.start_page}
              onChange={e => set('start_page', parseInt(e.target.value, 10))} />
          </div>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: 11 }}>Limit param name</label>
            <input className="form-input" style={{ fontSize: 12 }} value={config.limit_param}
              onChange={e => set('limit_param', e.target.value)} placeholder="limit" />
          </div>
        </div>
      )}

      {config.mode === 'offset' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: 11 }}>Offset param name</label>
            <input className="form-input" style={{ fontSize: 12 }} value={config.offset_param}
              onChange={e => set('offset_param', e.target.value)} placeholder="offset" />
          </div>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: 11 }}>Limit param name</label>
            <input className="form-input" style={{ fontSize: 12 }} value={config.limit_param}
              onChange={e => set('limit_param', e.target.value)} placeholder="limit" />
          </div>
        </div>
      )}

      {config.mode === 'cursor' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: 11 }}>Cursor path in response</label>
            <input className="form-input" style={{ fontSize: 12 }} value={config.cursor_path || ''}
              onChange={e => set('cursor_path', e.target.value)} placeholder="meta.next_cursor" />
          </div>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: 11 }}>Cursor query param</label>
            <input className="form-input" style={{ fontSize: 12 }} value={config.cursor_param}
              onChange={e => set('cursor_param', e.target.value)} placeholder="cursor" />
          </div>
        </div>
      )}

      {config.mode === 'link' && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: 4 }}>
          Follows <span className="mono">Link: &lt;url&gt;; rel="next"</span> response headers automatically. No extra configuration needed.
        </div>
      )}
    </div>
  );
}

// ─── Default pagination config ─────────────────────────────────────────────────

const defaultPagination = () => ({
  mode: 'none',
  page_param: 'page',
  offset_param: 'offset',
  limit_param: 'limit',
  page_size: 100,
  start_page: 1,
  cursor_path: '',
  cursor_param: 'cursor',
  max_rows: null,
});

// ─── Main component ────────────────────────────────────────────────────────────

export default function ApiDataSources() {
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('GET');
  const [headers, setHeaders] = useState([{ key: '', value: '' }]);
  const [requestBody, setRequestBody] = useState('');
  const [datasetName, setDatasetName] = useState('');
  const [jsonPath, setJsonPath] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pagination, setPagination] = useState(defaultPagination());

  const [previewData, setPreviewData] = useState(null);
  const [previewRows, setPreviewRows] = useState([]);
  const [availableColumns, setAvailableColumns] = useState([]);
  const [selectedColumns, setSelectedColumns] = useState(new Set());
  const [dataShape, setDataShape] = useState(null); // 'array-of-objects' | 'columnar' | 'single-object'

  const [loading, setLoading] = useState(false);
  const [savedConfigs, setSavedConfigs] = useState([]);
  const [configsLoading, setConfigsLoading] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [aiLoading, setAiLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const currentStep = deriveStep(previewData, availableColumns, success);

  // ── Headers management ──────────────────────────────────────────────────────
  const addHeader = () => setHeaders(h => [...h, { key: '', value: '' }]);
  const updateHeader = (i, field, val) => setHeaders(h => h.map((row, idx) => idx === i ? { ...row, [field]: val } : row));
  const removeHeader = (i) => setHeaders(h => h.filter((_, idx) => idx !== i));
  const formatHeaders = () => {
    const out = {};
    headers.forEach(h => { if (h.key.trim() && h.value.trim()) out[h.key.trim()] = h.value.trim(); });
    return out;
  };

  // Apply auth template — replaces or prepends the generated header
  const applyAuthTemplate = (newHeaders) => {
    // Remove any existing Authorization / matching key-name rows, then prepend
    const keys = newHeaders.map(h => h.key);
    const filtered = headers.filter(h => !keys.includes(h.key) || !h.value.trim());
    setHeaders([...newHeaders, ...filtered]);
  };

  // ── Extract & normalize columns ─────────────────────────────────────────────
  const extractColumns = useCallback((data, path) => {
    const target = resolvePath(data, path);
    if (!target || (typeof target !== 'object')) {
      setAvailableColumns([]);
      setSelectedColumns(new Set());
      setPreviewRows([]);
      setDataShape(null);
      return;
    }
    const shape = detectDataShape(target);
    setDataShape(shape);
    const rows = normalizeToRows(target);
    if (!rows.length) {
      setAvailableColumns([]);
      setSelectedColumns(new Set());
      setPreviewRows([]);
      return;
    }
    const colSet = new Set();
    rows.forEach(r => Object.keys(r).forEach(k => colSet.add(k)));
    const cols = Array.from(colSet);
    setAvailableColumns(cols);
    setSelectedColumns(new Set(cols));
    setPreviewRows(rows.slice(0, 5));
  }, []);

  // ── Tree path click ─────────────────────────────────────────────────────────
  const handleTreePathSelect = useCallback((path) => {
    setJsonPath(path);
    if (previewData) extractColumns(previewData, path);
    setError(null);
  }, [previewData, extractColumns]);

  const handlePathInput = (e) => {
    const val = e.target.value;
    setJsonPath(val);
    if (previewData) extractColumns(previewData, val);
  };

  // ── Parse request body safely ────────────────────────────────────────────────
  const parseBody = () => {
    if (!requestBody.trim()) return null;
    try { return JSON.parse(requestBody); }
    catch { return null; }
  };

  // ── Preview ─────────────────────────────────────────────────────────────────
  const handlePreview = async () => {
    if (!url) return;
    if (method === 'POST' && requestBody.trim()) {
      try { JSON.parse(requestBody); } catch {
        setError('Request body is not valid JSON.');
        return;
      }
    }
    setLoading(true);
    setError(null);
    setPreviewData(null);
    setAvailableColumns([]);
    setSelectedColumns(new Set());
    setPreviewRows([]);
    setSuccess(null);
    setDataShape(null);

    try {
      const response = await fetch(`${API_BASE}/api/api-sources/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, method, headers: formatHeaders(), body: parseBody() })
      });
      const data = await response.json();
      if (!response.ok) {
        const detail = data.detail;
        const msg = Array.isArray(detail)
          ? detail.map(e => `${e.loc?.slice(1).join('.')} — ${e.msg}`).join('; ')
          : (typeof detail === 'string' ? detail : 'Preview failed');
        throw new Error(msg);
      }
      setPreviewData(data);
      if (jsonPath) extractColumns(data, jsonPath);
      else {
        // Auto-extract if root is directly usable
        const shape = detectDataShape(data);
        if (shape !== 'unknown') extractColumns(data, '');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── AI auto-detect ──────────────────────────────────────────────────────────
  const handleAskAI = async () => {
    if (!url) return;
    setAiLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai/analyze-json-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, headers: formatHeaders() })
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'AI path detection failed'); }
      const data = await res.json();
      const detectedPath = data.path || '';
      setJsonPath(detectedPath);
      if (previewData) {
        extractColumns(previewData, detectedPath);
      } else {
        // Run preview first then extract
        setLoading(true);
        try {
          const pr = await fetch(`${API_BASE}/api/api-sources/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, method, headers: formatHeaders(), body: parseBody() })
          });
          const pd2 = await pr.json();
          if (!pr.ok) throw new Error(pd2.detail || 'Preview failed');
          setPreviewData(pd2);
          extractColumns(pd2, detectedPath);
        } finally { setLoading(false); }
      }
    } catch (e) {
      setError(`AI couldn't determine the path: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  // ── Fetch & Save ────────────────────────────────────────────────────────────
  const handleFetchAndSave = async () => {
    if (!url || !datasetName) return;
    if (method === 'POST' && requestBody.trim()) {
      try { JSON.parse(requestBody); } catch {
        setError('Request body is not valid JSON.');
        return;
      }
    }
    setFetching(true);
    setError(null);
    setSuccess(null);

    // Sanitize pagination payload — coerce empty strings and NaN to null so
    // Pydantic receives null (Optional[int]) rather than an invalid value
    const sanitizeInt = v => (v === '' || v === null || v === undefined || isNaN(v)) ? null : Number(v);
    const paginationPayload = {
      ...pagination,
      page_size:   sanitizeInt(pagination.page_size),
      start_page:  sanitizeInt(pagination.start_page),
      max_rows:    sanitizeInt(pagination.max_rows),
    };
    
    if (!paginationPayload.cursor_path) delete paginationPayload.cursor_path;
    if (!paginationPayload.max_rows) delete paginationPayload.max_rows;

    try {
      const payload = {
        url,
        method,
        headers: formatHeaders(),
        body: parseBody(),
        dataset_name: datasetName,
        json_path: jsonPath || null,
        columns: selectedColumns.size > 0 && selectedColumns.size < availableColumns.length
          ? Array.from(selectedColumns) : null,
        pagination: paginationPayload,
      };
      
      const response = await fetch(`${API_BASE}/api/api-sources/fetch`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}` 
        },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      if (!response.ok) {
        // Pydantic validation errors return detail as an array of objects
        const detail = data.detail;
        const msg = Array.isArray(detail)
          ? detail.map(e => `${e.loc?.slice(1).join('.')} — ${e.msg}`).join('; ')
          : (typeof detail === 'string' ? detail : 'Fetch failed');
        throw new Error(msg);
      }
      setSuccess(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setFetching(false);
    }
  };

  // ── Quick starts ─────────────────────────────────────────────────────────────
  const applyQuickStart = (qs) => {
    setUrl(qs.url);
    setJsonPath(qs.path);
    setDatasetName(qs.dataset);
    setMethod(qs.method || 'GET');
    setHeaders([{ key: '', value: '' }]);
    setRequestBody('');
    setPreviewData(null);
    setAvailableColumns([]);
    setSelectedColumns(new Set());
    setPreviewRows([]);
    setSuccess(null);
    setError(null);
    setDataShape(null);
    setPagination(defaultPagination());
  };

  const handleReset = () => applyQuickStart({ url: '', path: '', dataset: '', method: 'GET' });


  // ── Config persistence ──────────────────────────────────────────────────────

  const loadConfigs = useCallback(async () => {
    setConfigsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/api-sources/configs`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      setSavedConfigs(data);
    } catch (_) {
      // Non-critical — silently fail, user can retry
    } finally {
      setConfigsLoading(false);
    }
  }, []);

  useEffect(() => { loadConfigs(); }, [loadConfigs]);

  // Build the config blob to save — headers included but auth values
  // are blanked server-side, so we can pass them as-is here
  const buildConfigBlob = () => ({
    url,
    method,
    headers: formatHeaders(),
    request_body: requestBody,
    json_path: jsonPath,
    dataset_name: datasetName,
    pagination: { ...pagination },
  });

  const handleOpenSaveModal = () => {
    setSaveName(datasetName || url.replace(/^https?:\/\//, '').split('/')[0]);
    setSaveDescription('');
    setSaveError(null);
    setSaveSuccess(false);
    setSaveModalOpen(true);
  };

  const handleSaveConfig = async () => {
    if (!saveName.trim()) { setSaveError('Name is required.'); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${API_BASE}/api/api-sources/configs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({
          name: saveName.trim(),
          description: saveDescription.trim() || null,
          config: buildConfigBlob(),
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Save failed');
      setSavedConfigs(prev => [data, ...prev]);
      setSaveSuccess(true);
      setTimeout(() => setSaveModalOpen(false), 900);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLoadConfig = (cfg) => {
    const c = cfg.config;
    setUrl(c.url || '');
    setMethod(c.method || 'GET');
    setRequestBody(c.request_body || '');
    setJsonPath(c.json_path || '');
    setDatasetName(c.dataset_name || '');
    setPagination({ ...defaultPagination(), ...(c.pagination || {}) });
    // Restore headers — auth values will be blank (user must re-enter)
    if (c.headers && Object.keys(c.headers).length) {
      setHeaders(Object.entries(c.headers).map(([key, value]) => ({ key, value })));
    } else {
      setHeaders([{ key: '', value: '' }]);
    }
    // Clear preview state — user should re-run preview with restored config
    setPreviewData(null);
    setAvailableColumns([]);
    setSelectedColumns(new Set());
    setPreviewRows([]);
    setSuccess(null);
    setError(null);
    setDataShape(null);
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteConfig = async (id) => {
    setDeletingId(id);
    try {
      const res = await fetch(`${API_BASE}/api/api-sources/configs/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      setSavedConfigs(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      setError(`Delete failed: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  // ── Derived state ────────────────────────────────────────────────────────────
  const resolvedTarget = previewData ? resolvePath(previewData, jsonPath) : null;
  const targetIsUsable = resolvedTarget !== null && resolvedTarget !== undefined && typeof resolvedTarget === 'object';
  const rowEstimate = resolvedTarget
    ? (Array.isArray(resolvedTarget)
        ? resolvedTarget.length
        : isColumnar(resolvedTarget)
          ? Object.values(resolvedTarget)[0]?.length ?? 0
          : 1)
    : (previewData && isSelectableTarget(previewData) ? (Array.isArray(previewData) ? previewData.length : 1) : 0);

  const shapeNote = dataShape === 'columnar'
    ? '↔ Columnar format — parallel arrays transposed into rows'
    : dataShape === 'array-of-objects'
      ? '↓ Row format — array of objects'
      : dataShape === 'single-object'
        ? '{ } Single object — treated as one row'
        : null;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">API Data Sources</h1>
        <p className="page-description">Connect any JSON REST API and extract tabular datasets for ML training.</p>
      </div>

      <StepIndicator current={currentStep} />

      {/* Alerts */}
      {error && (
        <div className="card" style={{ marginBottom: 'var(--space-md)', borderColor: 'var(--color-error)' }}>
          <div className="card-body flex-row" style={{ color: 'var(--color-error)', gap: 8 }}>
            <AlertCircle size={16} /> <span>{error}</span>
          </div>
        </div>
      )}

      {success && (
        <div className="card" style={{ marginBottom: 'var(--space-md)', borderColor: 'var(--color-success)' }}>
          <div className="card-body" style={{ color: 'var(--color-success)' }}>
            <div className="flex-row" style={{ gap: 8, marginBottom: 8 }}>
              <CheckCircle size={16} />
              <span>
                Saved <strong>{success.row_count.toLocaleString()}</strong> rows ×{' '}
                <strong>{success.columns.length}</strong> columns to{' '}
                <span className="mono">{success.dataset_name}.csv</span>
                {success.pages_fetched > 1 && ` (${success.pages_fetched} pages fetched)`}
                {success.capped && <span style={{ color: 'var(--color-warning)', marginLeft: 8 }}>⚠ Row cap reached — not all data fetched</span>}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {success.columns.map(col => (
                <span key={col} className="badge badge-neutral mono" style={{ fontSize: 11 }}>{col}</span>
              ))}
            </div>
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={handleReset}>
              Start new import
            </button>
          </div>
        </div>
      )}

      {/* Quick starts */}
      <div className="grid-3" style={{ marginBottom: 'var(--space-md)' }}>
        {QUICK_STARTS.map((qs, i) => (
          <div key={i} className="card" style={{ cursor: 'pointer' }} onClick={() => applyQuickStart(qs)}>
            <div className="card-body">
              <div style={{ fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Globe size={14} />{qs.name}
              </div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {qs.url}
              </div>
              {qs.path && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>path: <span className="mono">{qs.path}</span></div>}
            </div>
          </div>
        ))}
      </div>

      {/* Main two-col layout */}
      <div className="two-col" style={{ marginBottom: 'var(--space-md)' }}>

        {/* ── Left: Request builder ── */}
        <div className="card">
          <div className="card-header"><span className="card-title">1 — Request builder</span></div>
          <div className="card-body">

            <AuthTemplateBar onApply={applyAuthTemplate} />

            <div className="form-group">
              <label className="form-label">Method & endpoint URL</label>
              <div className="flex-row" style={{ gap: 8 }}>
                <select
                  className="form-select"
                  value={method}
                  onChange={e => setMethod(e.target.value)}
                  style={{ width: 80, flexShrink: 0, fontSize: 13, fontWeight: 600 }}
                >
                  <option>GET</option>
                  <option>POST</option>
                </select>
                <input
                  className="form-input"
                  placeholder="https://api.example.com/v1/data"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  style={{ flex: 1 }}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Headers <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
              {headers.map((h, i) => (
                <div key={i} className="flex-row" style={{ marginBottom: 8, gap: 8 }}>
                  <input className="form-input" placeholder="Header name" value={h.key}
                    onChange={e => updateHeader(i, 'key', e.target.value)} style={{ flex: 1 }} />
                  <input className="form-input" placeholder="Value" value={h.value}
                    onChange={e => updateHeader(i, 'value', e.target.value)} style={{ flex: 2 }} />
                  <button className="btn btn-secondary" onClick={() => removeHeader(i)}><Trash2 size={14} /></button>
                </div>
              ))}
              <button className="btn btn-secondary btn-sm" onClick={addHeader}><Plus size={12} /> Add header</button>
            </div>

            {method === 'POST' && (
              <div className="form-group">
                <label className="form-label">Request body <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(JSON)</span></label>
                <textarea
                  className="form-input mono"
                  rows={5}
                  placeholder={'{\n  "query": "...",\n  "filters": {}\n}'}
                  value={requestBody}
                  onChange={e => setRequestBody(e.target.value)}
                  style={{ fontSize: 12, resize: 'vertical', fontFamily: 'monospace' }}
                />
                {requestBody.trim() && (() => { try { JSON.parse(requestBody); return null; } catch { return <div style={{ fontSize: 11, color: 'var(--color-error)', marginTop: 4 }}>⚠ Invalid JSON</div>; } })()}
              </div>
            )}

            {/* Advanced options toggle */}
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 'var(--space-md)', marginBottom: showAdvanced ? 12 : 0, color: 'var(--text-secondary)', fontSize: 13 }}
              onClick={() => setShowAdvanced(s => !s)}
            >
              <Settings size={13} />
              <span style={{ fontWeight: 500 }}>Advanced options</span>
              {showAdvanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {pagination.mode !== 'none' && (
                <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, background: 'var(--color-primary-bg, #eff6ff)', color: 'var(--color-primary)' }}>
                  pagination: {pagination.mode}
                </span>
              )}
            </div>

            {showAdvanced && (
              <div style={{ border: '1px solid var(--border-dark)', borderRadius: 6, padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>Pagination</div>
                <PaginationPanel config={pagination} onChange={setPagination} />
              </div>
            )}

            <button
              className="btn btn-primary"
              onClick={handlePreview}
              disabled={loading || !url}
              style={{ width: '100%', marginTop: 'var(--space-md)' }}
            >
              {loading ? <span className="spinner" /> : <Play size={14} />}
              {loading ? 'Fetching…' : 'Preview API response'}
            </button>
          </div>
        </div>

        {/* ── Right: Extraction & save ── */}
        <div className="card">
          <div className="card-header"><span className="card-title">3 — Extraction & save</span></div>
          <div className="card-body">

            <div className="form-group">
              <label className="form-label">Target JSON path</label>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                Click a node in the tree, or type a dot-notation path. Works with arrays and columnar objects.
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input
                  className="form-input"
                  placeholder="e.g. data.results or hourly"
                  value={jsonPath}
                  onChange={handlePathInput}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={handleAskAI}
                  disabled={aiLoading || loading || !url}
                >
                  <Sparkles size={12} />
                  {aiLoading ? 'Detecting…' : 'Auto-detect'}
                </button>
              </div>

              {/* Path / shape status */}
              {previewData && availableColumns.length > 0 && (
                <div style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, background: 'var(--color-success-bg, #f0fdf4)', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle size={12} />
                  {shapeNote} · {rowEstimate.toLocaleString()} rows · {availableColumns.length} columns
                </div>
              )}
              {previewData && !jsonPath && !isSelectableTarget(previewData) && (
                <div style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, background: 'var(--color-warning-bg, #fffbeb)', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertCircle size={12} /> Path does not point to usable data
                </div>
              )}
            </div>

            {availableColumns.length > 0 && (
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Columns to include</span>
                  <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                    {selectedColumns.size} / {availableColumns.length}
                  </span>
                </label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={() => setSelectedColumns(new Set(availableColumns))}>All</button>
                  <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={() => setSelectedColumns(new Set())}>None</button>
                </div>
                <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border-dark)', borderRadius: 4, padding: 8 }}>
                  {availableColumns.map(col => (
                    <label key={col} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4, cursor: 'pointer' }}>
                      <input type="checkbox" checked={selectedColumns.has(col)} onChange={e => {
                        const next = new Set(selectedColumns);
                        e.target.checked ? next.add(col) : next.delete(col);
                        setSelectedColumns(next);
                      }} />
                      <span className="mono">{col}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <hr style={{ borderColor: 'var(--border-dark)', margin: 'var(--space-md) 0' }} />

            <div className="form-group">
              <label className="form-label">Dataset name</label>
              <input className="form-input" placeholder="my_api_dataset" value={datasetName}
                onChange={e => setDatasetName(e.target.value)} />
            </div>

            <button
              className="btn"
              style={{
                width: '100%',
                backgroundColor: !fetching && url && datasetName ? 'var(--color-success)' : undefined,
                color: !fetching && url && datasetName ? '#fff' : undefined,
              }}
              onClick={handleFetchAndSave}
              disabled={fetching || !url || !datasetName}
            >
              {fetching ? <span className="spinner" /> : <Database size={14} />}
              {fetching ? 'Saving…' : 'Fetch & save CSV'}
            </button>

            {pagination.mode !== 'none' && !fetching && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
                Pagination active ({pagination.mode}) · cap {(pagination.max_rows || 50000).toLocaleString()} rows
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Step 2: JSON tree + preview table ── */}
      {previewData && (
        <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="card-title">2 — Explore response & select path</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Click any highlighted node to select it as the target
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: previewRows.length > 0 ? '1fr 1fr' : '1fr', gap: 0 }}>

            {/* Tree */}
            <div style={{ padding: 'var(--space-md)', borderRight: previewRows.length > 0 ? '1px solid var(--border-dark)' : 'none', overflowX: 'auto' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>Response tree</div>
              <div style={{ background: 'var(--bg-tertiary, #1a1a1a)', borderRadius: 6, padding: 12, maxHeight: 420, overflowY: 'auto' }}>
                <JsonNode
                  data={previewData}
                  path=""
                  depth={0}
                  onSelectPath={handleTreePathSelect}
                  selectedPath={jsonPath}
                />
              </div>
            </div>

            {/* Preview table */}
            {previewRows.length > 0 && (
              <div style={{ padding: 'var(--space-md)', overflow: 'hidden' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Data preview <span style={{ fontWeight: 400 }}>(first 5 rows · client-side)</span></span>
                  <span>{availableColumns.length} columns</span>
                </div>
                {shapeNote && (
                  <div style={{ fontSize: 11, color: 'var(--color-primary)', marginBottom: 6, padding: '3px 8px', background: 'var(--color-primary-bg, #eff6ff)', borderRadius: 4 }}>
                    {shapeNote}
                  </div>
                )}
                <div className="data-table-wrapper" style={{ maxHeight: 360, overflowY: 'auto', overflowX: 'auto' }}>
                  <table className="data-table" style={{ fontSize: 11 }}>
                    <thead>
                      <tr>
                        {availableColumns.slice(0, 8).map(col => (
                          <th key={col} className="mono" style={{ whiteSpace: 'nowrap', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{col}</th>
                        ))}
                        {availableColumns.length > 8 && <th style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>+{availableColumns.length - 8} more</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i}>
                          {availableColumns.slice(0, 8).map(col => (
                            <td key={col} className="mono" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {row[col] == null ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>null</span> : String(row[col])}
                            </td>
                          ))}
                          {availableColumns.length > 8 && <td />}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                  ~{rowEstimate.toLocaleString()} rows estimated · {availableColumns.length} columns ·{' '}
                  <span style={{ color: 'var(--color-success)' }}>ready to save</span>
                </div>
              </div>
            )}

            {/* Nudge if no usable data */}
            {availableColumns.length === 0 && (
              <div style={{ padding: 'var(--space-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  <AlertCircle size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
                  <div style={{ fontSize: 13 }}>Click a node in the tree to preview its data</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Arrays and columnar objects are both supported</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Save config button — shown after successful preview ── */}
      {previewData && !saveModalOpen && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-md)' }}>
          <button
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
            onClick={handleOpenSaveModal}
          >
            <BookmarkPlus size={14} />
            Save this configuration
          </button>
        </div>
      )}

      {/* ── Save config modal ── */}
      {saveModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card" style={{ width: 440, maxWidth: '90vw' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="card-title">Save configuration</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setSaveModalOpen(false)}>✕</button>
            </div>
            <div className="card-body">
              {saveError && (
                <div style={{ fontSize: 12, color: 'var(--color-error)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertCircle size={13} /> {saveError}
                </div>
              )}
              {saveSuccess && (
                <div style={{ fontSize: 12, color: 'var(--color-success)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle size={13} /> Saved!
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Name <span style={{ color: 'var(--color-error)' }}>*</span></label>
                <input
                  className="form-input"
                  placeholder="e.g. CoinGecko top 50 coins"
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">
                  Description <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span>
                </label>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="What this config fetches, any notes about the API, required credentials…"
                  value={saveDescription}
                  onChange={e => setSaveDescription(e.target.value)}
                  style={{ resize: 'vertical', fontSize: 13 }}
                />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: 4 }}>
                ℹ Auth header values are not stored — you will need to re-enter credentials when reloading this configuration.
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setSaveModalOpen(false)}>Cancel</button>
                <button
                  className="btn btn-primary"
                  onClick={handleSaveConfig}
                  disabled={saving || !saveName.trim()}
                >
                  {saving ? <span className="spinner" /> : <BookmarkPlus size={13} />}
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Saved configurations ── */}
      <div className="card" style={{ marginTop: 'var(--space-lg)' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="card-title">Saved configurations</span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={loadConfigs}
            disabled={configsLoading}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <RefreshCw size={12} style={{ animation: configsLoading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>

        {configsLoading && savedConfigs.length === 0 && (
          <div className="card-body" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Loading…
          </div>
        )}

        {!configsLoading && savedConfigs.length === 0 && (
          <div className="card-body" style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 'var(--space-lg)' }}>
            <BookmarkPlus size={24} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div>No saved configurations yet.</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>After a successful preview, click "Save this configuration" above.</div>
          </div>
        )}

        {savedConfigs.length > 0 && (
          <div style={{
            overflowX: 'auto',
            overflowY: 'auto',
            maxHeight: 420,
            padding: 'var(--space-md)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}>
            {savedConfigs.map(cfg => (
              <div key={cfg.id} className="card" style={{ flexShrink: 0, border: '1px solid var(--border-dark)' }}>
                <div className="card-body" style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Name + method badge */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{cfg.name}</span>
                        <span style={{
                          fontSize: 10, padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace', fontWeight: 700,
                          background: cfg.config.method === 'POST' ? 'var(--color-warning-bg, #fffbeb)' : 'var(--color-primary-bg, #eff6ff)',
                          color: cfg.config.method === 'POST' ? 'var(--color-warning)' : 'var(--color-primary)',
                        }}>
                          {cfg.config.method || 'GET'}
                        </span>
                        {cfg.config.pagination?.mode && cfg.config.pagination.mode !== 'none' && (
                          <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-secondary)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                            {cfg.config.pagination.mode}
                          </span>
                        )}
                      </div>

                      {/* URL */}
                      <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                        {cfg.config.url}
                      </div>

                      {/* Path */}
                      {cfg.config.json_path && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          path: <span className="mono">{cfg.config.json_path}</span>
                        </div>
                      )}

                      {/* Description */}
                      {cfg.description && (
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.4 }}>
                          {cfg.description}
                        </div>
                      )}

                      {/* Blanked-header warning */}
                      {cfg.config.headers && Object.values(cfg.config.headers).some(v => v === '') && (
                        <div style={{ fontSize: 11, color: 'var(--color-warning)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Key size={10} /> Credentials removed — re-enter after loading
                        </div>
                      )}

                      {/* Timestamp */}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={10} />
                        {new Date(cfg.updated_at).toLocaleString()}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleLoadConfig(cfg)}
                        style={{ fontSize: 12 }}
                      >
                        Load
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleDeleteConfig(cfg.id)}
                        disabled={deletingId === cfg.id}
                        style={{ color: 'var(--color-error)', fontSize: 12 }}
                      >
                        {deletingId === cfg.id ? <span className="spinner" /> : <Trash2 size={12} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}