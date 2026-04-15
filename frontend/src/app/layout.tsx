import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Viralexity Downloader',
  description: 'Download MP3 & MP4 from any URL',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
