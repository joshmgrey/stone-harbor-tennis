import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Stone Harbor Invitational Tennis – SHIT League",
  description: "Stone Harbor Invitational Tennis – schedule, sign-ups, and pairings",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col bg-gray-50 antialiased" suppressHydrationWarning>
        <header className="bg-green-800 text-white shadow-lg">
          <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
              {/* Tennis ball SVG logo */}
              <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                {/* Ball */}
                <circle cx="22" cy="22" r="20" fill="#c8e619" stroke="#a8c400" strokeWidth="1.5" />
                {/* Left seam */}
                <path d="M 8 14 C 14 18, 14 26, 8 30" stroke="white" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
                {/* Right seam */}
                <path d="M 36 14 C 30 18, 30 26, 36 30" stroke="white" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
              </svg>
              <div>
                <div className="text-2xl font-black tracking-tight leading-none">Stone Harbor Invitational Tennis</div>
                <div className="text-green-200 text-xs tracking-widest uppercase font-medium">
                  The SHIT League
                </div>
              </div>
            </Link>
            <Link
              href="/admin"
              className="text-green-200 hover:text-white text-sm font-medium transition-colors"
            >
              Admin
            </Link>
          </div>
        </header>

        <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">{children}</main>

        <footer className="bg-green-900 text-green-300 text-center text-xs py-4 mt-auto">
          Stone Harbor, NJ &nbsp;·&nbsp; SHIT League &nbsp;·&nbsp; Stone Harbor Invitational Tennis
        </footer>
      </body>
    </html>
  );
}
