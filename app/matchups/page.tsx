"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/src/lib/supabaseClient";
import { useRequireAuth } from "@/src/lib/useRequireAuth";
import { useRouter } from "next/navigation";

type League = {
  id: string;
  name: string;
  season_year: number;
  current_week: number;
  timezone: string;
};

type GameRow = {
  game_id: string;
  week_number: number;
  kickoff_time: string;
  status: "scheduled" | "inprogress" | "final";
  home_abbr: string;
  away_abbr: string;
  home_score: number | null;
  away_score: number | null;
  winner_abbr: string | null;
};

function fmtKickoff(dtIso: string) {
  const d = new Date(dtIso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function MatchupsPage() {
  const router = useRouter();
  const { loading } = useRequireAuth(); // membership gate is already inside the hook

  const [league, setLeague] = useState<League | null>(null);
  const [week, setWeek] = useState<number>(1);
  const [games, setGames] = useState<GameRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Load league once, set default week to current_week
  useEffect(() => {
    if (loading) return;

    async function loadLeague() {
      setErr(null);
      setBusy(true);

      const { data: leagues, error } = await supabase
        .from("leagues")
        .select("id,name,season_year,current_week,timezone")
        .limit(1);

      if (error) {
        setErr(error.message);
        setBusy(false);
        return;
      }

      if (!leagues || leagues.length === 0) {
        router.replace("/join");
        return;
      }

      const lg = leagues[0] as League;
      setLeague(lg);
      setWeek(lg.current_week);
      setBusy(false);
    }

    loadLeague();
  }, [loading, router]);

  // Load games whenever week changes
  useEffect(() => {
    if (!league) return;

    async function loadGames() {
      setErr(null);
      setBusy(true);

      const { data, error } = await supabase
        .from("games")
        .select(
          "game_id,week_number,kickoff_time,status,home_abbr,away_abbr,home_score,away_score,winner_abbr"
        )
        .eq("season_year", league.season_year)
        .eq("week_number", week)
        .order("kickoff_time", { ascending: true });

      if (error) {
        setErr(error.message);
        setGames([]);
        setBusy(false);
        return;
      }

      setGames((data ?? []) as GameRow[]);
      setBusy(false);
    }

    loadGames();
  }, [league, week]);

  const weekOptions = useMemo(() => {
    // Regular season weeks
    return Array.from({ length: 18 }, (_, i) => i + 1);
  }, []);

  if (loading) return null;

  return (
    <main className="mx-auto max-w-lg p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Matchups</h1>
          <p className="text-sm text-gray-600">
            {league ? `${league.name} • Season ${league.season_year}` : ""}
          </p>
        </div>

        <button
          className="text-sm text-gray-900 underline dark:text-zinc-100"
          onClick={() => router.push("/")}
        >
          ← Home
        </button>
      </header>

      <section className="mt-4 rounded border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Week</h2>
            <p className="mt-1 text-xs text-gray-500">
              Shows games from the <code>games</code> table.
            </p>
          </div>

          <select
            className="rounded border p-2 text-sm"
            value={week}
            onChange={(e) => setWeek(Number(e.target.value))}
            disabled={!league}
          >
            {weekOptions.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </div>

        {err && (
          <div className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {err}
          </div>
        )}

        {busy ? (
          <p className="mt-4 text-sm text-gray-500">Loading…</p>
        ) : games.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">
            No games found for Week {week}. (Run sync-games?)
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {games.map((g) => {
              const isFinal = g.status === "final";
              const isLive = g.status === "inprogress";

              return (
                <div key={g.game_id} className="rounded border p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">
                      {g.away_abbr} @ {g.home_abbr}
                    </div>

                    {isFinal ? (
                      <span className="rounded-full bg-gray-900 px-2 py-1 text-xs font-semibold text-white">
                        Final
                      </span>
                    ) : isLive ? (
                      <span className="rounded-full bg-amber-600 px-2 py-1 text-xs font-semibold text-white">
                        Live
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-600 px-2 py-1 text-xs font-semibold text-white">
                        Scheduled
                      </span>
                    )}
                  </div>

                  <div className="mt-1 text-xs text-gray-500">
                    Kickoff: {fmtKickoff(g.kickoff_time)}
                  </div>

                  {(g.home_score != null || g.away_score != null) && (
                    <div className="mt-2 text-sm">
                      <span className="font-medium">{g.away_abbr}</span>{" "}
                      {g.away_score ?? "-"}{" "}
                      <span className="text-gray-400">—</span>{" "}
                      <span className="font-medium">{g.home_abbr}</span>{" "}
                      {g.home_score ?? "-"}
                    </div>
                  )}

                  {g.winner_abbr && (
                    <div className="mt-1 text-xs text-gray-600">
                      Winner:{" "}
                      <span className="font-semibold">{g.winner_abbr}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
