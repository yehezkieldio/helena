import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Helena",
  description: "Audio-only rooms over WebRTC, WebTransport, and MoQ.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <main className="shell">
          <header className="topbar">
            <Link className="brand" href="/">
              <strong>Helena</strong>
              <span>RTP ingest / MoQ relay / fallback transport control</span>
            </Link>
            <nav className="nav" aria-label="Primary">
              <Link href="/studio">Studio</Link>
              <Link href="/listen">Listen</Link>
            </nav>
          </header>
          {children}
        </main>
      </body>
    </html>
  );
}
