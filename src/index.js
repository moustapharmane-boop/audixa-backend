const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');
const { isValidUrl } = require('./lib/validateUrl');

const app = express();
const PORT = process.env.PORT || 3001;

const DOWNLOADS_DIR = path.join(__dirname, '../downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (
      origin === 'http://localhost:3000' ||
      origin.endsWith('.vercel.app') ||
      origin === process.env.FRONTEND_URL
    ) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  }
}));
app.use(express.json());

const jobs = {};
const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(200);

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of Object.entries(jobs)) {
    if (now - job._createdAt > 30 * 60 * 1000) {
      if (job.filePath && fs.existsSync(job.filePath)) fs.unlink(job.filePath, () => {});
      jobEvents.removeAllListeners(id);
      delete jobs[id];
    }
  }
}, 5 * 60 * 1000);

const VIDEO_FORMAT_STRINGS = {
  '360p':  'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best[ext=mp4]/best',
  '480p':  'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[ext=mp4]/best',
  '720p':  'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[ext=mp4]/best',
  '1080p': 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[ext=mp4]/best',
};

// GET /api/formats?url= — fetch available qualities for a URL
app.get('/api/formats', (req, res) => {
  const { url } = req.query;
  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid or blocked URL.' });
  }

  let output = '';
  let errOutput = '';
  const proc = spawn('yt-dlp', [url, '-J', '--no-playlist']);

  proc.stdout.on('data', (d) => { output += d; });
  proc.stderr.on('data', (d) => { errOutput += d; });

  let responded = false;
  proc.on('error', () => {
    if (!responded) { responded = true; res.status(500).json({ error: 'yt-dlp not found. Please install it.' }); }
  });

  proc.on('close', (code) => {
    if (responded) return;
    if (code !== 0) {
      return res.status(500).json({ error: 'Could not fetch video info. Check the URL.' });
    }
    try {
      const info = JSON.parse(output);
      const formats = info.formats || [];

      // Collect unique video heights that have both video and audio (or video-only, we merge anyway)
      const heights = new Set();
      for (const f of formats) {
        if (f.height && f.vcodec && f.vcodec !== 'none') {
          heights.add(f.height);
        }
      }

      // Map to our supported quality labels
      const allMp4 = [
        { label: '360p', h: 360 },
        { label: '480p', h: 480 },
        { label: '720p', h: 720 },
        { label: '1080p', h: 1080 },
      ];

      const mp4 = allMp4
        .filter(({ h }) => [...heights].some((fh) => fh >= h - 30 && fh <= h + 30))
        .map(({ label }) => label);

      // Always offer 720p as fallback if nothing matched
      const mp4Qualities = mp4.length > 0 ? mp4 : ['720p'];

      res.json({
        mp3: ['128k', '192k', '320k'],
        mp4: mp4Qualities,
        title: info.title || '',
        thumbnail: info.thumbnail || '',
      });
    } catch {
      res.status(500).json({ error: 'Failed to parse video info.' });
    }
  });
});

// POST /api/download — start a download job
app.post('/api/download', (req, res) => {
  const { url, format, quality, title } = req.body;

  if (!url || !format || !['mp3', 'mp4'].includes(format)) {
    return res.status(400).json({ error: 'Provide a valid URL and format (mp3 or mp4).' });
  }
  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid or blocked URL.' });
  }

  const jobId = uuidv4();
  jobs[jobId] = {
    id: jobId, status: 'pending', progress: 0,
    url, format, quality: quality || (format === 'mp3' ? '192k' : '720p'),
    filePath: null, title: title || null, error: null,
    _createdAt: Date.now(),
  };

  res.json({ jobId });
  startDownload(jobId);
});

// GET /api/stream/:jobId — SSE progress
app.get('/api/stream/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  if (job.status === 'done') { send({ status: 'done', progress: 100, downloadUrl: `/api/file/${job.id}` }); return res.end(); }
  if (job.status === 'error') { send({ status: 'error', error: job.error }); return res.end(); }

  send({ status: job.status, progress: job.progress });

  const onEvent = (data) => {
    send(data);
    if (data.status === 'done' || data.status === 'error') {
      jobEvents.off(job.id, onEvent);
      res.end();
    }
  };

  jobEvents.on(job.id, onEvent);
  req.on('close', () => jobEvents.off(job.id, onEvent));
});

// GET /api/file/:jobId — serve file with Content-Disposition: attachment (forces download)
app.get('/api/file/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job || job.status !== 'done' || !job.filePath) {
    return res.status(404).json({ error: 'File not ready.' });
  }

  const sanitized = (job.title || 'viralexity-download')
    .replace(/[<>:"/\\|?*]/g, '').trim().replace(/\s+/g, ' ').slice(0, 100);
  const filename = `${sanitized}.${job.format}`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  res.download(job.filePath, filename, (err) => {
    if (err && !res.headersSent) res.status(500).json({ error: 'Download failed.' });
    setTimeout(() => {
      if (job.filePath && fs.existsSync(job.filePath)) fs.unlink(job.filePath, () => {});
      delete jobs[job.id];
    }, 120000);
  });
});

function startDownload(jobId) {
  const job = jobs[jobId];
  const outputTemplate = path.join(DOWNLOADS_DIR, `${jobId}.%(ext)s`);

  const args = job.format === 'mp3'
    ? [job.url, '-x', '--audio-format', 'mp3', '--postprocessor-args', `ffmpeg:-b:a ${job.quality}`, '-o', outputTemplate, '--newline', '--no-playlist']
    : [job.url, '-f', VIDEO_FORMAT_STRINGS[job.quality] || VIDEO_FORMAT_STRINGS['720p'], '--merge-output-format', 'mp4', '-o', outputTemplate, '--newline', '--no-playlist'];

  job.status = 'running';
  jobEvents.emit(jobId, { status: 'running', progress: 0 });

  const proc = spawn('yt-dlp', args);

  const handleOutput = (data) => {
    for (const line of data.toString().split('\n')) {
      const m = line.match(/\[download\]\s+([\d.]+)%/);
      if (m) {
        job.progress = Math.min(parseFloat(m[1]), 99);
        jobEvents.emit(jobId, { status: 'running', progress: job.progress });
      }
      const t = line.match(/Destination:.*[/\\]([^/\\]+)\.(mp3|mp4|webm|mkv|m4a|opus)$/);
      if (t) job.title = t[1];
    }
  };

  proc.stdout.on('data', handleOutput);
  proc.stderr.on('data', handleOutput);

  let jobErrored = false;
  proc.on('error', () => {
    if (jobErrored) return;
    jobErrored = true;
    job.status = 'error';
    job.error = 'yt-dlp not found. Please install it.';
    jobEvents.emit(jobId, { status: 'error', error: job.error });
  });

  proc.on('close', (code) => {
    if (jobErrored) return;
    if (code === 0) {
      const files = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.startsWith(jobId));
      if (files.length > 0) {
        const file = files.find(f => f.endsWith(`.${job.format}`)) || files[0];
        job.filePath = path.join(DOWNLOADS_DIR, file);
        job.status = 'done';
        job.progress = 100;
        jobEvents.emit(jobId, { status: 'done', progress: 100, downloadUrl: `/api/file/${jobId}` });
      } else {
        job.status = 'error';
        job.error = 'Output file not found.';
        jobEvents.emit(jobId, { status: 'error', error: job.error });
      }
    } else {
      job.status = 'error';
      job.error = 'Download failed. Check the URL and try again.';
      jobEvents.emit(jobId, { status: 'error', error: job.error });
    }
  });
}

app.listen(PORT, () => console.log(`Viralexity MVP backend running on http://localhost:${PORT}`));
