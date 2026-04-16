'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';

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

export default function DownloaderClient({
  heading,
  subheading,
  defaultFormat,
}: {
  heading: string;
  subheading: string;
  defaultFormat: 'mp3' | 'mp4';
}) {
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
          es.close(); delete esRefs.current[key];
        } else if (msg.status === 'error') {
          setJobState(key, { status: 'error', error: msg.error || 'Unknown error.', progress: 0 });
          es.close(); delete esRefs.current[key];
        }
      };
      es.onerror = () => {
        setJobState(key, { status: 'error', error: 'Connection lost. Try again.', progress: 0 });
        es.close(); delete esRefs.current[key];
      };
    } catch {
      setJobState(key, { status: 'error', error: 'Could not reach backend.', progress: 0 });
    }
  };

  const job = (format: 'mp3' | 'mp4', quality: string): JobState =>
    jobs[`${format}-${quality}`] ?? { status: 'idle', progress: 0, error: '' };

  const qualitiesToShow = formats
    ? (defaultFormat === 'mp3' ? formats.mp3 : formats.mp4)
    : [];

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      {/* Nav */}
      <div className="w-full max-w-xl mb-6 flex gap-3 text-sm">
        <Link href="/" className="text-gray-500 hover:text-white transition-colors">← Home</Link>
        <Link href="/youtube-to-mp3" className={`transition-colors ${defaultFormat === 'mp3' ? 'text-green-400 font-semibold' : 'text-gray-500 hover:text-white'}`}>MP3</Link>
        <Link href="/youtube-to-mp4" className={`transition-colors ${defaultFormat === 'mp4' ? 'text-blue-400 font-semibold' : 'text-gray-500 hover:text-white'}`}>MP4</Link>
      </div>

      {/* Header */}
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          <span className="text-white">{heading.split(' ').slice(0, 2).join(' ')} </span>
          <span className={defaultFormat === 'mp3' ? 'text-green-400' : 'text-blue-400'}>
            {heading.split(' ').slice(2).join(' ')}
          </span>
        </h1>
        <p className="mt-2 text-gray-400 text-sm">{subheading}</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-xl bg-[#111] border border-white/10 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row gap-2">
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
            className={`w-full sm:w-auto px-5 py-3 rounded-xl font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap ${
              defaultFormat === 'mp3'
                ? 'bg-green-500 hover:bg-green-400 text-black'
                : 'bg-blue-500 hover:bg-blue-400 text-white'
            }`}
          >
            {fetchPhase === 'fetching' ? 'Loading…' : 'Fetch Qualities'}
          </button>
        </div>

        {fetchPhase === 'error' && (
          <div className="mt-4 flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <span className="text-red-400">✕</span>
            <p className="text-red-400 text-sm">{fetchError}</p>
          </div>
        )}

        {fetchPhase === 'fetching' && (
          <div className="mt-6 flex items-center justify-center gap-3 text-gray-400 text-sm">
            <span className="inline-block w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            Fetching available qualities…
          </div>
        )}

        {fetchPhase === 'ready' && formats && (
          <div className="mt-6 space-y-4">
            {formats.title && (
              <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                {formats.thumbnail && (
                  <img src={formats.thumbnail} alt="" className="w-16 h-10 object-cover rounded-lg flex-shrink-0" />
                )}
                <p className="text-sm text-gray-300 line-clamp-2">{formats.title}</p>
              </div>
            )}

            <div className={`border rounded-xl p-4 ${defaultFormat === 'mp3' ? 'border-green-500/30 bg-green-500/5' : 'border-blue-500/30 bg-blue-500/5'}`}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${defaultFormat === 'mp3' ? 'text-green-400 bg-green-500/10' : 'text-blue-400 bg-blue-500/10'}`}>
                  {defaultFormat.toUpperCase()}
                </span>
                <span className="text-xs text-gray-500">{qualitiesToShow.length} options</span>
              </div>
              <div className="space-y-2">
                {qualitiesToShow.map((q) => {
                  const j = job(defaultFormat, q);
                  const btnClass = defaultFormat === 'mp3'
                    ? 'bg-green-500 hover:bg-green-400 text-black'
                    : 'bg-blue-500 hover:bg-blue-400 text-white';
                  const barClass = defaultFormat === 'mp3' ? 'bg-green-500' : 'bg-blue-500';
                  return (
                    <div key={q} className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-200 font-medium w-16 flex-shrink-0">{q}</span>
                        <div className="flex-1" />
                        {j.status === 'done' ? (
                          <span className="text-xs text-green-400 font-medium">✓ Downloaded</span>
                        ) : j.status === 'error' ? (
                          <span className="text-xs text-red-400">{j.error}</span>
                        ) : (
                          <button
                            onClick={() => download(defaultFormat, q)}
                            disabled={j.status === 'loading'}
                            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${btnClass}`}
                          >
                            {j.status === 'loading' ? 'Downloading…' : `Download ${defaultFormat.toUpperCase()}`}
                          </button>
                        )}
                      </div>
                      {j.status === 'loading' && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-300 ${barClass}`} style={{ width: `${j.progress}%` }} />
                          </div>
                          <span className="text-xs text-gray-500 w-8 text-right">{Math.round(j.progress)}%</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="mt-8 text-xs text-gray-600">Only download content you have the right to use.</p>
    </main>
  );
}
