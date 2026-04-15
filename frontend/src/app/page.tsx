'use client';

import { useState, useRef } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://audixa-backend-production-80e7.up.railway.app';

interface Formats {
  mp3: string[];
  mp4: string[];
  title: string;
  thumbnail: string;
}

interface JobState {
  status: 'idle' | 'loading' | 'done' | 'error';
  progress: number;
  error: string;
}

type Jobs = Record<string, JobState>;

export default function Home() {
  const [url, setUrl] = useState('');
  const [fetchPhase, setFetchPhase] = useState<'idle' | 'fetching' | 'ready' | 'error'>('idle');
  const [fetchError, setFetchError] = useState('');
  const [formats, setFormats] = useState<Formats | null>(null);
  const [jobs, setJobs] = useState<Jobs>({});
  const esRefs = useRef<Record<string, EventSource>>({});

  const resetAll = () => {
    Object.values(esRefs.current).forEach(es => es.close());
    esRefs.current = {};
    setJobs({});
    setFormats(null);
    setFetchPhase('idle');
    setFetchError('');
  };

  const fetchFormats = async () => {
    if (!url.trim()) return;
    resetAll();
    setFetchPhase('fetching');

    try {
      const res = await fetch(`${API}/api/formats?url=${encodeURIComponent(url.trim())}`);
      const data = await res.json();
      if (!res.ok) { setFetchPhase('error'); setFetchError(data.error || 'Failed to fetch formats.'); return; }
      setFormats(data);
      setFetchPhase('ready');
    } catch {
      setFetchPhase('error');
      setFetchError('Could not reach backend.');
    }
  };

  const triggerAutoDownload = (fileUrl: string) => {
    const a = document.createElement('a');
    a.href = fileUrl;
    a.download = '';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const setJobState = (key: string, patch: Partial<JobState>) => {
    setJobs(prev => ({ ...prev, [key]: { ...prev[key], ...patch } as JobState }));
  };

  const download = async (format: 'mp3' | 'mp4', quality: string) => {
    if (!url.trim()) return;
    const key = `${format}-${quality}`;

    // Close any existing SSE for this key
    if (esRefs.current[key]) { esRefs.current[key].close(); delete esRefs.current[key]; }

    setJobState(key, { status: 'loading', progress: 0, error: '' });

    try {
      const res = await fetch(`${API}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), format, quality, title: formats?.title }),
      });
      const data = await res.json();
      if (!res.ok) { setJobState(key, { status: 'error', error: data.error || 'Request failed.', progress: 0 }); return; }

      const es = new EventSource(`${API}/api/stream/${data.jobId}`);
      esRefs.current[key] = es;

      es.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.status === 'running') {
          setJobState(key, { progress: msg.progress ?? 0 });
        } else if (msg.status === 'done') {
          setJobState(key, { status: 'done', progress: 100 });
          triggerAutoDownload(`${API}${msg.downloadUrl}`);
          es.close();
          delete esRefs.current[key];
        } else if (msg.status === 'error') {
          setJobState(key, { status: 'error', error: msg.error || 'Unknown error.', progress: 0 });
          es.close();
          delete esRefs.current[key];
        }
      };

      es.onerror = () => {
        setJobState(key, { status: 'error', error: 'Connection lost. Try again.', progress: 0 });
        es.close();
        delete esRefs.current[key];
      };
    } catch {
      setJobState(key, { status: 'error', error: 'Could not reach backend.', progress: 0 });
    }
  };

  const job = (format: 'mp3' | 'mp4', quality: string): JobState =>
    jobs[`${format}-${quality}`] ?? { status: 'idle', progress: 0, error: '' };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      {/* Logo */}
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          <span className="text-white">Viralexity</span>
          <span className="text-green-400"> Downloader</span>
        </h1>
        <p className="mt-2 text-gray-400 text-sm">Download MP3 & MP4 from YouTube and more</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-xl bg-[#111] border border-white/10 rounded-2xl p-6 shadow-xl">
        {/* URL input + fetch button */}
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); if (fetchPhase !== 'idle') resetAll(); }}
            placeholder="Paste a YouTube URL..."
            onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) fetchFormats(); }}
            className="flex-1 bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:border-green-500 transition-colors"
          />
          <button
            onClick={fetchFormats}
            disabled={!url.trim() || fetchPhase === 'fetching'}
            className="px-5 py-3 rounded-xl font-semibold text-sm bg-green-500 hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed text-black transition-colors whitespace-nowrap"
          >
            {fetchPhase === 'fetching' ? 'Loading…' : 'Fetch Qualities'}
          </button>
        </div>

        {/* Fetch error */}
        {fetchPhase === 'error' && (
          <div className="mt-4 flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <span className="text-red-400">✕</span>
            <p className="text-red-400 text-sm">{fetchError}</p>
          </div>
        )}

        {/* Fetching spinner */}
        {fetchPhase === 'fetching' && (
          <div className="mt-6 flex items-center justify-center gap-3 text-gray-400 text-sm">
            <span className="inline-block w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            Fetching available qualities…
          </div>
        )}

        {/* Quality panels */}
        {fetchPhase === 'ready' && formats && (
          <div className="mt-6 space-y-5">
            {/* Video info */}
            {formats.title && (
              <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                {formats.thumbnail && (
                  <img src={formats.thumbnail} alt="" className="w-16 h-10 object-cover rounded-lg flex-shrink-0" />
                )}
                <p className="text-sm text-gray-300 line-clamp-2">{formats.title}</p>
              </div>
            )}

            {/* MP3 */}
            <QualitySection
              label="MP3"
              accent="green"
              qualities={formats.mp3}
              format="mp3"
              getJob={job}
              onDownload={download}
            />

            {/* MP4 */}
            <QualitySection
              label="MP4"
              accent="blue"
              qualities={formats.mp4}
              format="mp4"
              getJob={job}
              onDownload={download}
            />
          </div>
        )}
      </div>

      <p className="mt-8 text-xs text-gray-600">Only download content you have the right to use.</p>
    </main>
  );
}

function QualitySection({
  label, accent, qualities, format, getJob, onDownload,
}: {
  label: string;
  accent: 'green' | 'blue';
  qualities: string[];
  format: 'mp3' | 'mp4';
  getJob: (format: 'mp3' | 'mp4', quality: string) => JobState;
  onDownload: (format: 'mp3' | 'mp4', quality: string) => void;
}) {
  const accentClass = accent === 'green'
    ? 'border-green-500/30 bg-green-500/5'
    : 'border-blue-500/30 bg-blue-500/5';
  const badgeClass = accent === 'green'
    ? 'text-green-400 bg-green-500/10'
    : 'text-blue-400 bg-blue-500/10';

  return (
    <div className={`border rounded-xl p-4 ${accentClass}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${badgeClass}`}>{label}</span>
        <span className="text-xs text-gray-500">{qualities.length} option{qualities.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="space-y-2">
        {qualities.map((q) => {
          const j = getJob(format, q);
          return (
            <QualityRow
              key={q}
              quality={q}
              format={format}
              jobState={j}
              accent={accent}
              onDownload={() => onDownload(format, q)}
            />
          );
        })}
      </div>
    </div>
  );
}

function QualityRow({
  quality, format, jobState, accent, onDownload,
}: {
  quality: string;
  format: 'mp3' | 'mp4';
  jobState: JobState;
  accent: 'green' | 'blue';
  onDownload: () => void;
}) {
  const btnClass = accent === 'green'
    ? 'bg-green-500 hover:bg-green-400 text-black'
    : 'bg-blue-500 hover:bg-blue-400 text-white';
  const barClass = accent === 'green' ? 'bg-green-500' : 'bg-blue-500';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-200 font-medium w-16 flex-shrink-0">{quality}</span>
        <div className="flex-1" />
        {jobState.status === 'done' ? (
          <span className="text-xs text-green-400 font-medium">✓ Downloaded</span>
        ) : jobState.status === 'error' ? (
          <span className="text-xs text-red-400">{jobState.error}</span>
        ) : (
          <button
            onClick={onDownload}
            disabled={jobState.status === 'loading'}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${btnClass}`}
          >
            {jobState.status === 'loading' ? 'Downloading…' : `Download ${format.toUpperCase()}`}
          </button>
        )}
      </div>
      {jobState.status === 'loading' && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${barClass}`}
              style={{ width: `${jobState.progress}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 w-8 text-right">{Math.round(jobState.progress)}%</span>
        </div>
      )}
    </div>
  );
}
