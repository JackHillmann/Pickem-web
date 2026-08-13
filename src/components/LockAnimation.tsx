"use client";

export function LockAnimation({ label }: { label: string }) {
  return (
    <div
      className="animate-lock-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-10 py-8 shadow-xl dark:bg-zinc-900">
        <div className="relative flex items-center justify-center">
          <span className="animate-lock-ring absolute h-14 w-14 rounded-full bg-emerald-400/50" />
          <div className="animate-lock-body relative">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
              <rect x="5" y="11" width="14" height="10" rx="2" fill="#059669" />
              <path
                d="M8 11V7a4 4 0 0 1 8 0v4"
                stroke="#059669"
                strokeWidth="2.2"
                strokeLinecap="round"
                fill="none"
                className="animate-lock-shackle"
              />
              <circle cx="12" cy="15" r="1.6" fill="white" />
              <rect x="11.3" y="15" width="1.4" height="3" rx="0.7" fill="white" />
            </svg>
          </div>
        </div>
        <p className="animate-lock-text text-sm font-semibold text-gray-900 dark:text-zinc-100">
          {label}
        </p>
      </div>
    </div>
  );
}
