import type { Metadata } from 'next';
import DownloaderClient from '../_components/DownloaderClient';

export const metadata: Metadata = {
  title: 'YouTube to MP4 Downloader — Free HD Download | Viralexity',
  description: 'Download YouTube videos as MP4 in 360p, 720p or 1080p. Free, fast, no account needed.',
};

export default function YoutubeToMp4Page() {
  return (
    <DownloaderClient
      heading="YouTube to MP4"
      subheading="Download any YouTube video as MP4 — HD quality, free, no signup"
      defaultFormat="mp4"
    />
  );
}
