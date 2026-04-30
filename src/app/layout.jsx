import './globals.css';

export const metadata = {
  title: 'KTC NextTrade Hub',
  description: 'KTC Trading Operations — Finance, CRM, Shipping, Admin',
  manifest: '/manifest.json',
  themeColor: '#0ea5e9',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'KTC Hub' },
  viewport: { width: 'device-width', initialScale: 1, maximumScale: 1 },
};

// v55.38 — translate="no" + the Google notranslate meta together stop Chrome
// from auto-translating the page. When Chrome translates, it rewrites text
// nodes in place; React then sees a DOM that doesn't match what it rendered
// and throws hydration errors (#418/#423/#425), which crashes the whole app.
// This was a major contributor to the Emad-only login bounce-out — his
// browser's Arabic locale was triggering an auto-translate offer.
export default function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" translate="no">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#0ea5e9" />
        <meta name="google" content="notranslate" />
      </head>
      <body className="notranslate" style={{ background: '#0a0e1a', minHeight: '100vh' }}>
        {children}
      </body>
    </html>
  );
}
