"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/src/lib/supabaseClient";
import { useRequireAuth } from "@/src/lib/useRequireAuth";
import { useRouter } from "next/navigation";


type League = {
  id: string;
  name: string;
  season_year: number;
};

type Member = {
  user_id: string;
  display_name: string | null;
};

type PickResult = {
  user_id: string;
  result: "win" | "loss" | "pending" | "push";
};

export default function StandingsPage() {
  const { loading } = useRequireAuth();
  const router = useRouter();

  const [league, setLeague] = useState<League | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [results, setResults] = useState<PickResult[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const rows = useMemo(() => {
    const nameByUser = new Map<string, string>();
    members.forEach((m) => nameByUser.set(m.user_id, m.display_name || "Member"));

    const agg = new Map<string, { wins: number; losses: number; pending: number; push: number }>();
    results.forEach((r) => {
      const cur = agg.get(r.user_id) ?? { wins: 0, losses: 0, pending: 0, push: 0 };
      if (r.result === "win") cur.wins += 1;
      else if (r.result === "loss") cur.losses += 1;
      else if (r.result === "push") cur.push += 1;
      else cur.pending += 1;
      agg.set(r.user_id, cur);
    });

    // Ensure everyone appears even if no results yet
    members.forEach((m) => {
      if (!agg.has(m.user_id)) agg.set(m.user_id, { wins: 0, losses: 0, pending: 0, push: 0 });
    });

    const out = [...agg.entries()].map(([user_id, a]) => ({
      user_id,
      name: nameByUser.get(user_id) || "Member",
      ...a,
    }));

    out.sort((a, b) => {
      // wins desc, losses asc, pending asc
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (a.losses !== b.losses) return a.losses - b.losses;
      return a.pending - b.pending;
    });

    return out;
  }, [members, results]);

  useEffect(() => {
    if (loading) return;

    async function load() {
      setBusy(true);
      setErr(null);

      // league
      const { data: leagues, error: leaguesErr } = await supabase
        .from("leagues")
        .select("id,name,season_year")
        .limit(1);

      if (leaguesErr) {
        setErr(leaguesErr.message);
        setBusy(false);
        return;
      }
      if (!leagues || leagues.length === 0) {
        setErr("No league found.");
        setBusy(false);
        return;
      }
      const lg = leagues[0] as League;
      setLeague(lg);

      // members (for names)
      const { data: memRows, error: memErr } = await supabase
        .from("league_members")
        .select("user_id,display_name")
        .eq("league_id", lg.id);

      if (memErr) {
        setErr(memErr.message);
        setBusy(false);
        return;
      }
      setMembers((memRows ?? []) as any);

      // results (season totals)
      const { data: resRows, error: resErr } = await supabase
        .from("pick_results")
        .select("user_id,result")
        .eq("league_id", lg.id)
        .eq("season_year", lg.season_year);

      if (resErr) {
        setErr(resErr.message);
        setBusy(false);
        return;
      }
      setResults((resRows ?? []) as any);

      setBusy(false);
    }

    load();
  }, [loading]);

  if (loading || busy) return null;

  return (
    <main className="mx-auto max-w-lg p-4">
<div className="mb-3 flex items-center justify-between">
  <button
className="text-sm text-gray-900 underline dark:text-zinc-100"
    onClick={() => router.push("/")}
  >
    ← Home
  </button>

  <h1 className="text-xl font-semibold">
    {league?.name} Standings
  </h1>

  <div /> {/* spacer */}
</div>
      <p className="mt-1 text-sm text-gray-600">Season {league?.season_year}</p>

      {err && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      <section className="mt-4 rounded border">
        <div className="grid grid-cols-12 gap-2 border-b p-3 text-xs font-semibold text-gray-600">
          <div className="col-span-6">Player</div>
          <div className="col-span-2 text-right">W</div>
          <div className="col-span-2 text-right">L</div>
          <div className="col-span-2 text-right">Pending</div>
        </div>

        {rows.map((r) => (
          <div key={r.user_id} className="grid grid-cols-12 gap-2 border-b p-3 text-sm">
            <div className="col-span-6 font-medium">{r.name}</div>
            <div className="col-span-2 text-right">{r.wins}</div>
            <div className="col-span-2 text-right">{r.losses}</div>
            <div className="col-span-2 text-right">{r.pending}</div>
          </div>
        ))}

        {rows.length === 0 && (
          <div className="p-3 text-sm text-gray-600">No results yet.</div>
        )}
      </section>
    </main>
  );
}
