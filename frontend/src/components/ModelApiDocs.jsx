import React, { useState } from 'react';
import { Copy, Check, Code2, Terminal, Braces } from 'lucide-react';

const API_BASE = 'http://localhost:8000';

/**
 * ModelApiDocs
 *
 * Shows how to call a trained model's prediction endpoint via
 * curl, Python requests, or raw JSON schema. Place below PredictionTester
 * in the MLTraining results view.
 *
 * Props:
 *   model — the detailModel object (needs: job_id, feature_names, task_type, target_column)
 */
export default function ModelApiDocs({ model }) {
    const [activeTab, setActiveTab] = useState('curl');
    const [copied, setCopied] = useState(false);

    if (!model?.job_id || !model?.feature_names?.length) return null;

    const endpoint = `${API_BASE}/api/ml-training/predict/${model.job_id}`;

    // Build a representative example payload from feature names
    const examplePayload = {};
    (model.feature_names || []).forEach((f, i) => {
        // Alternate between example numeric and string values so the snippet looks realistic
        examplePayload[f] = i % 3 === 0 ? 'example_value' : i % 3 === 1 ? 42 : 0;
    });
    const payloadJson = JSON.stringify(examplePayload, null, 2);
    const payloadCompact = JSON.stringify(examplePayload);

    const snippets = {
        curl: `curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -d '${payloadCompact}'`,

        python: `import requests

url = "${endpoint}"
payload = ${payloadJson}

response = requests.post(url, json=payload)
result = response.json()

print(result["prediction_display"])
# Returns: predicted value for "${model.target_column}"`,

        schema: `{
  "endpoint": "${endpoint}",
  "method": "POST",
  "content_type": "application/json",
  "task_type": "${model.task_type}",
  "target_column": "${model.target_column}",
  "request_body": {
${(model.feature_names || []).map(f => `    "${f}": <number | string>`).join(',\n')}
  },
  "response_body": {
    "job_id": "${model.job_id}",
    "target_column": "${model.target_column}",
    "task_type": "${model.task_type}",
    "prediction": <raw_value>,
    "prediction_display": <formatted_string>
  }
}`,
    };

    const tabs = [
        { id: 'curl', label: 'curl', Icon: Terminal },
        { id: 'python', label: 'Python', Icon: Code2 },
        { id: 'schema', label: 'JSON Schema', Icon: Braces },
    ];

    const handleCopy = () => {
        navigator.clipboard.writeText(snippets[activeTab]).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <div className="card" style={{ marginTop: 'var(--space-md)' }}>
            {/* Header */}
            <div className="card-header">
                <span className="card-title">API Integration</span>
                <span
                    className="badge badge-neutral mono"
                    style={{ fontSize: 10, letterSpacing: '0.02em' }}
                    title="Full endpoint URL"
                >
                    POST /api/ml-training/predict/{model.job_id}
                </span>
            </div>

            <div className="card-body" style={{ paddingTop: 'var(--space-sm)' }}>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 'var(--space-md)', lineHeight: 1.6 }}>
                    This model is deployed and accessible via its own REST endpoint. Send feature values
                    as a JSON body — raw strings and numbers are accepted, preprocessing is handled automatically.
                </p>

                {/* Endpoint pill */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-light)',
                    borderRadius: 6,
                    padding: '8px 12px',
                    marginBottom: 'var(--space-md)',
                    overflowX: 'auto',
                }}>
                    <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        background: 'rgba(79,70,229,0.18)',
                        color: '#818cf8',
                        padding: '2px 6px',
                        borderRadius: 4,
                        flexShrink: 0,
                    }}>
                        POST
                    </span>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                        {endpoint}
                    </span>
                </div>

                {/* Tab bar */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 0, borderBottom: '1px solid var(--border-light)' }}>
                    {tabs.map(({ id, label, Icon }) => (
                        <button
                            key={id}
                            onClick={() => setActiveTab(id)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                padding: '6px 12px',
                                fontSize: 12,
                                fontWeight: activeTab === id ? 600 : 400,
                                color: activeTab === id ? 'var(--text-primary)' : 'var(--text-tertiary)',
                                background: 'none',
                                border: 'none',
                                borderBottom: activeTab === id ? '2px solid var(--text-primary)' : '2px solid transparent',
                                cursor: 'pointer',
                                marginBottom: -1,
                                transition: 'color 0.15s',
                            }}
                        >
                            <Icon size={12} />
                            {label}
                        </button>
                    ))}

                    {/* Copy button — far right */}
                    <button
                        onClick={handleCopy}
                        title="Copy snippet"
                        style={{
                            marginLeft: 'auto',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 10px',
                            fontSize: 11,
                            color: copied ? 'var(--color-success)' : 'var(--text-tertiary)',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            transition: 'color 0.2s',
                        }}
                    >
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                </div>

                {/* Code block */}
                <pre style={{
                    margin: 0,
                    padding: '16px 14px',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '0 0 6px 6px',
                    fontSize: 11.5,
                    lineHeight: 1.7,
                    color: 'var(--text-primary)',
                    overflowX: 'auto',
                    whiteSpace: 'pre',
                    fontFamily: 'var(--font-mono)',
                    border: '1px solid var(--border-light)',
                    borderTop: 'none',
                }}>
                    <code>{snippets[activeTab]}</code>
                </pre>

                {/* Footer note */}
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 10, lineHeight: 1.5 }}>
                    <strong style={{ color: 'var(--text-secondary)' }}>Tip:</strong> Blank or missing features default to{' '}
                    <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>0</code>. The endpoint handles
                    categorical encoding and normalization internally — no preprocessing needed on the client.
                </p>
            </div>
        </div>
    );
}
