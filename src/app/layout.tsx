import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kiln",
  description: "A conversational coding agent for a selected local project. Inspired by Claude Code workflows, with an original interface.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f3efe6",
};

const themeBoot = `(() => { try { var t = localStorage.getItem('kiln.theme') || 'system'; var d = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.classList.toggle('dark', d); document.documentElement.dataset.theme = t; } catch (e) {} })();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
