import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { lookup } from './api';
import type { GeoIpRecord, GeoIpResponse } from './types';

const HISTORY_KEY = 'geoip-wla:history';
const HISTORY_MAX = 10;

type Status = 'idle' | 'loading' | 'done' | 'error';

/** Load the lookup history from localStorage (tolerant of missing/blocked storage). */
function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

/** Persist the lookup history (no-op if storage is unavailable). */
function saveHistory(history: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* private mode, quota, or storage disabled — history is best-effort */
  }
}

function flagEmoji(cc: string | null): string {
  if (!cc || !/^[a-z]{2}$/i.test(cc)) return '\u{1F310}'; // globe
  const A = 'A'.charCodeAt(0);
  const base = 0x1f1e6;
  const u = cc.toUpperCase();
  return String.fromCodePoint(base + u.charCodeAt(0) - A, base + u.charCodeAt(1) - A);
}

function looksLikeIp(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  const v4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) return v4.slice(1).every((n) => Number(n) <= 255);
  return /^[0-9a-f:]+$/i.test(s) && s.includes(':');
}

function fmt(v: string | number | null | undefined): string {
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

// Tokenise pretty-printed JSON into coloured spans (VS Code "Dark+" palette).
const JSON_TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlightJson(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  JSON_TOKEN.lastIndex = 0;
  while ((m = JSON_TOKEN.exec(src)) !== null) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const [full, str, colon, lit, num] = m;
    if (str !== undefined && colon !== undefined) {
      out.push(
        <span key={key++} className="tok-key">
          {str}
        </span>,
        <span key={key++} className="tok-punc">
          {colon}
        </span>,
      );
    } else if (str !== undefined) {
      out.push(
        <span key={key++} className="tok-str">
          {str}
        </span>,
      );
    } else if (lit !== undefined) {
      out.push(
        <span key={key++} className="tok-lit">
          {lit}
        </span>,
      );
    } else if (num !== undefined) {
      out.push(
        <span key={key++} className="tok-num">
          {num}
        </span>,
      );
    }
    last = m.index + full.length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

function recordRows(r: GeoIpRecord): Array<{ label: string; value: string }> {
  const coords =
    r.latitude !== null && r.longitude !== null
      ? `${r.latitude}, ${r.longitude}`
      : '—';
  const range =
    r.network_start && r.network_end
      ? `${r.network_start} – ${r.network_end}`
      : '—';
  return [
    { label: 'Country', value: `${fmt(r.country_name)} (${fmt(r.country_code)} / ${fmt(r.country_code3)})` },
    { label: 'Continent', value: fmt(r.continent_code) },
    { label: 'Region', value: `${fmt(r.region_name)} (${fmt(r.region)})` },
    { label: 'City', value: fmt(r.city) },
    { label: 'Postal code', value: fmt(r.postal_code) },
    { label: 'Coordinates', value: coords },
    { label: 'Time zone', value: fmt(r.time_zone) },
    { label: 'Metro / DMA code', value: `${fmt(r.metro_code)} / ${fmt(r.dma_code)}` },
    { label: 'Area code', value: fmt(r.area_code) },
    { label: 'Netmask', value: fmt(r.netmask) },
    { label: 'Network range', value: range },
  ];
}

export function App() {
  const [ip, setIp] = useState('8.8.8.8');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<GeoIpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept in App (not ResultView) so it survives across lookups.
  const [rawOpen, setRawOpen] = useState(false);
  // Looked-up addresses, most recent first. Seeded from localStorage.
  const [history, setHistory] = useState<string[]>(loadHistory);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  const ipWarning = useMemo(
    () =>
      ip.trim() && !looksLikeIp(ip)
        ? 'That does not look like an IPv4 or IPv6 address.'
        : null,
    [ip],
  );

  const runLookup = useCallback(async (address: string) => {
    const value = address.trim();
    if (!value) return;
    setIp(value);
    setStatus('loading');
    setError(null);
    try {
      const data = await lookup(value);
      setResult(data);
      setStatus('done');
      setHistory((prev) =>
        [value, ...prev.filter((h) => h !== value)].slice(0, HISTORY_MAX),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed');
      setResult(null);
      setStatus('error');
    }
  }, []);

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-inner">
          <h1>
            <span className="globe">{'\u{1F30D}'}</span> GeoIP Lookup
          </h1>
          <p>Resolve an IP address to a location.</p>
          {__APP_BASE_URL__ !== '/' ? (
            <a className="home-link" href="/">
              Home
            </a>
          ) : null}
        </div>
      </header>

      <main className="container">
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            void runLookup(ip);
          }}
        >
          <label htmlFor="ip" className="sr-only">
            IP address
          </label>
          <input
            id="ip"
            className="search-input"
            placeholder="e.g. 8.8.8.8"
            value={ip}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setIp(e.target.value)}
          />
          <button
            className="search-btn"
            type="submit"
            disabled={status === 'loading' || !ip.trim()}
          >
            {status === 'loading' ? 'Looking up…' : 'Lookup'}
          </button>
        </form>

        {ipWarning && <p className="hint">{ipWarning}</p>}

        {status === 'error' && (
          <div className="card error">
            <strong>Lookup failed.</strong> {error}
            <div className="error-tip">Please check the address and try again.</div>
          </div>
        )}

        {status === 'done' && result && (
          <ResultView
            data={result}
            rawOpen={rawOpen}
            onToggleRaw={() => setRawOpen((v) => !v)}
          />
        )}

        {history.length > 0 && (
          <section className="history">
            <div className="history-head">
              <h2>Recent lookups</h2>
              <button
                type="button"
                className="history-clear"
                onClick={() => setHistory([])}
              >
                Clear
              </button>
            </div>
            <ul className="history-list">
              {history.map((h) => (
                <li key={h}>
                  <button type="button" onClick={() => void runLookup(h)}>
                    {h}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="foot">
        <span>
          Copyright &copy; 2026 &middot; MIT &middot;{' '}
          <a href={__APP_HOMEPAGE__} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </span>
      </footer>
    </div>
  );
}

function ResultView({
  data,
  rawOpen,
  onToggleRaw,
}: {
  data: GeoIpResponse;
  rawOpen: boolean;
  onToggleRaw: () => void;
}) {
  const r = data.record;

  const title = r
    ? `${r.city ? `${r.city}, ` : ''}${r.country_name ?? 'Unknown'}`
    : 'No record found';

  const rows = r ? recordRows(r) : [];
  const rawJson = JSON.stringify(data, null, 2);
  const [copied, setCopied] = useState(false);

  const copyRaw = useCallback(() => {
    navigator.clipboard
      ?.writeText(rawJson)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* clipboard blocked — ignore */
      });
  }, [rawJson]);

  return (
    <div className="card result">
      <div className="result-head">
        <span className="flag">{flagEmoji(r?.country_code ?? null)}</span>
        <div>
          <div className="result-title">{title}</div>
          <div className="result-sub">
            <div>
              {data.ip ?? '(no ip)'} &middot; database <code>{data.database}</code>
              {data.database_build ? (
                <>
                  {' '}
                  &middot; build <code>{data.database_build}</code>
                </>
              ) : null}
            </div>
            {data.preset ? (
              <div>
                preset <code>{data.preset}</code>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {r ? (
        <dl className="fields">
          {rows.map((row) => (
            <div className="field" key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
          {rows.length % 2 === 1 ? (
            <div className="field field-filler" aria-hidden="true" />
          ) : null}
        </dl>
      ) : (
        <p className="empty">
          No location data for this address &mdash; it is not present in the
          database (unknown, private, or reserved range).
        </p>
      )}

      <div className="result-actions">
        <button type="button" className="raw-toggle" onClick={onToggleRaw}>
          {rawOpen ? 'Hide' : 'Show'} raw JSON response
        </button>
        {data.library ? (
          <span className="result-library">
            <code>{data.library}</code>
          </span>
        ) : null}
      </div>
      {rawOpen && (
        <div className="raw-wrap">
          <button
            type="button"
            className="raw-copy"
            onClick={copyRaw}
            aria-label={copied ? 'Copied' : 'Copy JSON'}
            title={copied ? 'Copied' : 'Copy JSON'}
          >
            {copied ? (
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path
                  d="M20 6 9 17l-5-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <rect
                  x="9"
                  y="9"
                  width="12"
                  height="12"
                  rx="2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M5 15V5a2 2 0 0 1 2-2h10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>
          <pre className="raw">{highlightJson(rawJson)}</pre>
        </div>
      )}
    </div>
  );
}
