import './globals.css';

export const metadata = {
  title: 'KTC NextTrade Hub',
  description: 'KTC Trading Operations — Finance, CRM, Shipping, Admin',
  manifest: '/manifest.json',
  themeColor: '#0ea5e9',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'KTC Hub' },
  viewport: { width: 'device-width', initialScale: 1, maximumScale: 1 },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#0ea5e9" />
      </head>
      <body style={{ background: '#0a0e1a', minHeight: '100vh' }}>
        {children}
      </body>
    </html>
  );
}
