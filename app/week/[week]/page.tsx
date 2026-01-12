"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/src/lib/supabaseClient";
import { useRequireAuth } from "@/src/lib/useRequireAuth";

type League = {
  id: string;
  name: string;
  season_year: number;
};

type WeekCfg = {
  picks_required: 1 | 2;
  lock_time: string;
  reveal_time: string;
};

type RosterRow = { league_id: string; user_id: string; display_name: string | null };

type PickRow = {
  user_id: string;
  slot: 1 | 2;
  team_abbr: string;
};

function fmt(dtIso: string) {
  const d = new Date(dtIso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function WeekPage() {
  const { userId, loading } = useRequireAuth();
  const params = useParams<{ week: string }>();
  const weekNumber = Number(params.week);

  const [league, setLeague] = useState<League | null>(null);
  const [weekCfg, setWeekCfg] = useState<WeekCfg | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const revealed = useMemo(() => {
    if (!weekCfg) return false;
    return Date.now() >= new Date(weekCfg.reveal_time).getTime();
  }, [weekCfg]);

  const picksByUser = useMemo(() => {
    const map = new Map<string, { 1?: string; 2?: string }>();
    for (const p of picks) {
      const cur = map.get(p.user_id) ?? {};
      cur[p.slot] = p.team_abbr;
      map.set(p.user_id, cur);
    }
    return map;
  }, [picks]);

  useEffect(() => {
    if (loading) return;
    if (!Number.isFinite(weekNumber) || weekNumber < 1 || weekNumber > 18) {
      setErr("Invalid week number.");
      setBusy(false);
      return;
    }

    async function load() {
      setBusy(true);
      setErr(null);

      // 1) League (pick the first league for now)
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
        setErr("No league found. Join a league first.");
        setBusy(false);
        return;
      }

      const lg = leagues[0] as League;
      setLeague(lg);

      // 2) Week config
      const { data: weekRows, error: weekErr } = await supabase
        .from("weeks")
        .select("picks_required,lock_time,reveal_time")
        .eq("league_id", lg.id)
        .eq("season_year", lg.season_year)
        .eq("week_number", weekNumber)
        .limit(1);

      if (weekErr) {
        setErr(weekErr.message);
        setBusy(false);
        return;
      }
      if (!weekRows || weekRows.length === 0) {
        setErr("Week config missing in DB (weeks table).");
        setBusy(false);
        return;
      }

      const wc = weekRows[0] as WeekCfg;
      setWeekCfg(wc);

      // 3) Roster (to show “No picks”)
      const { data: rosterRows, error: rosterErr } = await supabase
        .from("league_members")
        .select("league_id,user_id,display_name")
        .eq("league_id", lg.id);

      if (rosterErr) {
        setErr(rosterErr.message);
        setBusy(false);
        return;
      }
      setRoster((rosterRows ?? []) as any);

      // 4) Picks
      // RLS will automatically enforce reveal behavior:
      // - If not revealed, this select returns ONLY your picks.
      // - If revealed, it returns all picks in the league for that week.
      const { data: pickRows, error: picksErr } = await supabase
        .from("picks")
        .select("user_id,slot,team_abbr")
        .eq("league_id", lg.id)
        .eq("season_year", lg.season_year)
        .eq("week_number", weekNumber)
        .order("user_id", { ascending: true })
        .order("slot", { ascending: true });

      if (picksErr) {
        setErr(picksErr.message);
        setBusy(false);
        return;
      }
      setPicks((pickRows ?? []) as any);

      setBusy(false);
    }

    load();
  }, [loading, userId, weekNumber]);

  if (loading || busy) return null;

  return (
    <main className="mx-auto max-w-lg p-4">
      <h1 className="text-xl font-semibold">
        {league?.name} • Week {weekNumber}
      </h1>

      {weekCfg && (
        <p className="mt-1 text-xs text-gray-600">
          Locks & Reveals: {fmt(weekCfg.lock_time)} •{" "}
          {revealed ? "Revealed" : "Hidden until kickoff"}
        </p>
      )}

      {err && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      <section className="mt-6 rounded border p-4">
        <h2 className="text-base font-semibold">Picks</h2>

        {!weekCfg ? (
          <p className="mt-2 text-sm text-gray-600">No week config.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {roster.map((m) => {
              const isMe = m.user_id === userId;
              const picked = picksByUser.get(m.user_id);

              // Before reveal, only show your own row; others show as "Hidden"
              if (!revealed && !isMe) {
                return (
                  <div key={m.user_id} className="flex items-center justify-between rounded border p-3">
                    <div className="text-sm font-medium">Member</div>
                    <div className="text-sm text-gray-500">Hidden until kickoff</div>
                  </div>
                );
              }

              // After reveal (or if it's you), show picks or "No picks"
              const p1 = picked?.[1];
              const p2 = weekCfg.picks_required === 2 ? picked?.[2] : undefined;

              const right =
                weekCfg.picks_required === 1 ? (
                  p1 ? (
                    <span className="font-semibold">{p1}</span>
                  ) : (
                    <span className="text-gray-500">No picks</span>
                  )
                ) : (
                  <span className="font-semibold">
                    {p1 ?? <span className="text-gray-500 font-normal">No picks</span>}
                    {"  "}
                    {p2 ? (
                      <span className="ml-2">{p2}</span>
                    ) : (
                      <span className="ml-2 text-gray-500 font-normal">No picks</span>
                    )}
                  </span>
                );

              return (
                <div key={m.user_id} className="flex items-center justify-between rounded border p-3">
<div className="text-sm font-medium">
  {isMe ? "You" : m.display_name || "Member"}
</div>                 <div className="text-sm">{right}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="mt-3 text-xs text-gray-500">
        Note: The database also enforces the reveal rule. Before kickoff, this page literally cannot fetch other users’ picks.
      </p>
    </main>
  );
}
