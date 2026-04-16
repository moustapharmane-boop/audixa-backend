import type { Metadata } from 'next';
import DownloaderClient from '../_components/DownloaderClient';

export const metadata: Metadata = {
  title: 'YouTube to MP3 Converter — Free & Fast | Viralexity',
  description: 'Convert YouTube videos to MP3 for free. Choose 128k, 192k or 320k audio quality. No signup, instant download.',
};

export default function YoutubeToMp3Page() {
  return (
    <DownloaderClient
      heading="YouTube to MP3"
      subheading="Convert any YouTube video to MP3 — free, fast, no signup"
      defaultFormat="mp3"
    />
  );
}
