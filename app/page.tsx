"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/src/lib/supabaseClient";

export default function HomePage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthed(!!session);
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-lg p-6">
        <header className="mt-6">
          <h1 className="text-3xl font-semibold tracking-tight">Pick’em League</h1>
          <p className="mt-2 text-gray-700">
            Pick 2 teams each week (weeks 1–16), then 1 team (weeks 17–18).
            You can only use each team once all season, and you get 1 bye.
          </p>
        </header>

        <section className="mt-8 space-y-3">
          {authed ? (
            <>
              <button
                className="w-full rounded-xl bg-black px-4 py-3 text-white"
                onClick={() => router.push("/picks")}
              >
                Go to picks
              </button>

              <button
                className="w-full rounded-xl border px-4 py-3"
                onClick={() => router.push("/standings")}
              >
                View standings
              </button>

              <button
                className="w-full rounded-xl border px-4 py-3"
                onClick={async () => {
                  await supabase.auth.signOut();
                  router.push("/login");
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <button
                className="w-full rounded-xl bg-black px-4 py-3 text-white"
                onClick={() => router.push("/login")}
              >
                Log in
              </button>

              <button
                className="w-full rounded-xl border px-4 py-3"
                onClick={() => router.push("/join")}
              >
                Join a league
              </button>
            </>
          )}
        </section>

        <section className="mt-8 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">How it works</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
            <li>Weeks 1–16: pick 2 winning teams</li>
            <li>Weeks 17–18: pick 1 winning team</li>
            <li>No team can be picked more than once all season</li>
            <li>1 bye week allowed (weeks 1–16)</li>
            <li>Picks lock at the first game (Thursday)</li>
            <li>Picks are revealed after lock</li>
          </ul>
        </section>

        <footer className="mt-10 text-center text-xs text-gray-500">
          No ads, no nonsense BS.
        </footer>
      </div>
    </main>
  );
}
