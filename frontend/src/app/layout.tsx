import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Viralexity — Free YouTube MP3 & MP4 Downloader',
  description: 'Download YouTube videos as MP3 or MP4 for free. Fast, easy, no signup required.',
  verification: {
    google: '9RGqwujFbC2n423kvDfM2RER_35re4HA-czsW07_SQQ',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
