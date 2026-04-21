import type { Metadata } from 'next';
import './globals.css';

// The whole app is authenticated & reads localStorage — skip SSG for every route.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'OpenApplicantTracking',
  description: 'Open-source, multi-tenant, multi-region ATS.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
