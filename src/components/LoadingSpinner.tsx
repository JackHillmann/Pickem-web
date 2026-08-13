export function LoadingSpinner() {
  return (
    <main className="flex min-h-[50vh] items-center justify-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900 dark:border-zinc-700 dark:border-t-zinc-100"
        role="status"
        aria-label="Loading"
      />
    </main>
  );
}
