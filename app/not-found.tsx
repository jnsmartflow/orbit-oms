import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 text-center px-4">
      <div className="space-y-2">
        <p className="text-5xl font-bold text-gray-200">404</p>
        <h1 className="text-2xl font-bold text-gray-900">Page not found</h1>
        <p className="text-gray-500 max-w-sm">
          The page you are looking for does not exist or has been moved.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex items-center rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50"
      >
        Go home
      </Link>
    </main>
  );
}
