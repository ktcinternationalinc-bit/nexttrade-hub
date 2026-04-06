import './globals.css';

export const metadata = {
  title: 'NextTrade Hub - KTC Financial Dashboard',
  description: 'KTC Trading Operations Dashboard',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr">
      <body className="min-h-screen bg-slate-100">
        {children}
      </body>
    </html>
  );
}
