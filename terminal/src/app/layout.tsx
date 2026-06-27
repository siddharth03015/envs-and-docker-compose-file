import type { Metadata } from 'next'
import { AuthModalProvider } from '@/context/AuthModalContext'
import { ShortcutsModalProvider } from '@/context/ShortcutsModalContext'
import AuthModal from '@/components/AuthModal'
import ShortcutsModal from '@/components/ShortcutsModal'
import AppBoot from '@/components/AppBoot'
import './globals.css'

export const metadata: Metadata = {
  title: 'Synthetic Bull | Trading Terminal',
  description: 'Real-time simulated crypto & stock exchange — OpenSoft 2026',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#000000" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=IBM+Plex+Mono:wght@300;400;500&family=Geist:wght@300;400;500&display=swap" rel="stylesheet" />
      </head>
      <body suppressHydrationWarning>
        <script
          id="theme-script"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark')}catch(e){document.documentElement.setAttribute('data-theme','dark')}})();`,
          }}
        />
        <AuthModalProvider>
          <ShortcutsModalProvider>
            <AppBoot />
            {children}
            <AuthModal />
            <ShortcutsModal />
          </ShortcutsModalProvider>
        </AuthModalProvider>
      </body>
    </html>
  )
}
