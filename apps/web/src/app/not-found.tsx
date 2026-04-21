import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex h-full items-center justify-center p-8">
      <div className="text-center">
        <p className="text-sm font-medium text-brand-600">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link href="/" className="mt-6 inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white">
          Go home
        </Link>
      </div>
    </main>
  );
}
