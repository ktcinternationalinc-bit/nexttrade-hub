import './globals.css';

export const metadata = {
  title: 'NextTrade Hub - KTC Trading Operations',
  description: 'KTC Trading Operations — International Trading & Logistics Dashboard',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr">
      <body style={{ background: '#0a0e1a', minHeight: '100vh' }}>
        {children}
      </body>
    </html>
  );
}
