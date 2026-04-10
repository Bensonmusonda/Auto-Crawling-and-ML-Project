import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BookOpen, Search, Copy, Check, AlertCircle } from 'lucide-react';
import './DocsViewer.css';

const API_BASE = 'http://localhost:8000';

// ── Skeleton loading component ───────────────────────────────────────────────
function DocSkeleton() {
  return (
    <div className="docs-skeleton">
      <div className="docs-skeleton-line title" />
      <div className="docs-skeleton-line" />
      <div className="docs-skeleton-line" />
      <div className="docs-skeleton-line short" />
      <div className="docs-skeleton-line" style={{ marginTop: 24 }} />
      <div className="docs-skeleton-line" />
      <div className="docs-skeleton-line short" />
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function DocsViewer({ activeSlug, onSlugChange }) {
  const [docs, setDocs] = useState([]);       // list of DocMeta
  const [content, setContent] = useState(null); // DocContent with .html
  const [loading, setLoading] = useState(true);
  const [docLoading, setDocLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const readerRef = useRef(null);

  // ── Fetch doc list on mount ────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/docs`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => { setDocs(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  // ── Fetch single doc when slug changes ────────────────────────────────────
  useEffect(() => {
    if (!activeSlug) { setContent(null); return; }
    setDocLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/docs/${activeSlug}`)
      .then(r => {
        if (!r.ok) throw new Error(`Document not found (${r.status})`);
        return r.json();
      })
      .then(data => { setContent(data); setDocLoading(false); })
      .catch(err => { setError(err.message); setDocLoading(false); });
  }, [activeSlug]);

  // ── Scroll reader to top when doc changes ─────────────────────────────────
  useEffect(() => {
    if (readerRef.current) readerRef.current.scrollTop = 0;
  }, [activeSlug]);

  // ── Inject "Copy" buttons into code blocks after render ───────────────────
  useEffect(() => {
    if (!content || !readerRef.current) return;

    const pres = readerRef.current.querySelectorAll('pre');
    pres.forEach(pre => {
      // Avoid double-wrapping
      if (pre.parentElement.classList.contains('docs-code-block')) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'docs-code-block';
      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);

      const btn = document.createElement('button');
      btn.className = 'docs-copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', () => {
        const code = pre.querySelector('code')?.innerText || pre.innerText;
        navigator.clipboard.writeText(code).then(() => {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = 'Copy';
            btn.classList.remove('copied');
          }, 2000);
        });
      });
      wrapper.appendChild(btn);
    });
  }, [content]);

  // ── Group docs by category ────────────────────────────────────────────────
  const filtered = docs.filter(d =>
    !search || d.title.toLowerCase().includes(search.toLowerCase()) ||
    (d.description || '').toLowerCase().includes(search.toLowerCase())
  );

  const grouped = filtered.reduce((acc, doc) => {
    const cat = doc.category || 'General';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(doc);
    return acc;
  }, {});

  const categories = Object.keys(grouped).sort();

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="docs-layout">
      {/* ── Sidebar ── */}
      <aside className="docs-sidebar">
        <div className="docs-sidebar-header">
          <div className="docs-sidebar-title">Docs &amp; Guides</div>
          <div className="docs-sidebar-search">
            <Search size={12} className="docs-search-icon" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        <nav className="docs-sidebar-nav">
          {loading ? (
            <div style={{ padding: '16px 24px', fontSize: 12, color: 'var(--text-muted)' }}>
              Loading…
            </div>
          ) : categories.length === 0 ? (
            <div style={{ padding: '16px 24px', fontSize: 12, color: 'var(--text-muted)' }}>
              {search ? 'No results.' : 'No docs available.'}
            </div>
          ) : (
            categories.map(cat => (
              <div key={cat} className="docs-category">
                <div className="docs-category-label">{cat}</div>
                {grouped[cat].map(doc => (
                  <button
                    key={doc.slug}
                    className={`docs-nav-item ${activeSlug === doc.slug ? 'active' : ''}`}
                    onClick={() => onSlugChange(doc.slug)}
                  >
                    {doc.title}
                    {doc.description && (
                      <span className="docs-nav-item-desc">{doc.description}</span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </nav>
      </aside>

      {/* ── Reader ── */}
      <div className="docs-reader" ref={readerRef}>
        <div className="docs-reader-inner">
          {!activeSlug ? (
            <div className="docs-welcome">
              <BookOpen size={48} className="docs-welcome-icon" />
              <h2>Docs &amp; Guides</h2>
              <p>Select a document from the sidebar to get started. Use the search box to find guides quickly.</p>
            </div>
          ) : docLoading ? (
            <DocSkeleton />
          ) : error ? (
            <div className="docs-error">
              <AlertCircle size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              {error}
            </div>
          ) : content ? (
            <div
              className="docs-content"
              dangerouslySetInnerHTML={{ __html: content.html }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
