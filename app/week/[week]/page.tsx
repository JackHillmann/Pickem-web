"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/src/lib/supabaseClient";
import { useRequireAuth } from "@/src/lib/useRequireAuth";
import { useRouter } from "next/navigation";
import { TeamLogo } from "@/src/components/TeamLogo";
import { LoadingSpinner } from "@/src/components/LoadingSpinner";


type League = {
  id: string;
  name: string;
  season_year: number;
  current_season_type: number;
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

type ByeRow = { user_id: string };

type ResultKind = "win" | "loss" | "pending" | "push";

type PickResultRow = {
  user_id: string;
  slot: 1 | 2;
  team_abbr: string;
  result: ResultKind;
};

function keyPick(userId: string, slot: number, teamAbbr: string) {
  return `${userId}:${slot}:${teamAbbr}`;
}

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
  const router = useRouter();

  const [league, setLeague] = useState<League | null>(null);
  const [weekCfg, setWeekCfg] = useState<WeekCfg | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [byeUserIds, setByeUserIds] = useState<Set<string>>(new Set());
  const [resultByPick, setResultByPick] = useState<Map<string, ResultKind>>(
    new Map()
  );
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
        .select("id,name,season_year,current_season_type")
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
        .eq("season_type", lg.current_season_type)
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
        .eq("season_type", lg.current_season_type)
        .order("user_id", { ascending: true })
        .order("slot", { ascending: true });

      if (picksErr) {
        setErr(picksErr.message);
        setBusy(false);
        return;
      }
      setPicks((pickRows ?? []) as any);

      // 4b) Pick results for this week — graded per-game as each game goes
      // final (same source the standings page reads), so picks turn
      // green/red one at a time instead of all at once at week's end.
      const { data: resultRows, error: resultsErr } = await supabase
        .from("pick_results")
        .select("user_id,slot,team_abbr,result")
        .eq("league_id", lg.id)
        .eq("season_year", lg.season_year)
        .eq("week_number", weekNumber)
        .eq("season_type", lg.current_season_type);

      if (resultsErr) {
        setErr(resultsErr.message);
        setBusy(false);
        return;
      }

      const resultMap = new Map<string, ResultKind>();
      ((resultRows ?? []) as PickResultRow[]).forEach((r) => {
        resultMap.set(keyPick(r.user_id, r.slot, r.team_abbr), r.result);
      });
      setResultByPick(resultMap);

      // 5) Byes — same reveal semantics as picks (RLS scopes to your own
      // row until reveal, then everyone's)
      const { data: byeRows, error: byeErr } = await supabase
        .from("byes")
        .select("user_id")
        .eq("league_id", lg.id)
        .eq("season_year", lg.season_year)
        .eq("week_number", weekNumber)
        .eq("season_type", lg.current_season_type);

      if (byeErr) {
        setErr(byeErr.message);
        setBusy(false);
        return;
      }
      setByeUserIds(new Set(((byeRows ?? []) as ByeRow[]).map((b) => b.user_id)));

      setBusy(false);
    }

    load();
  }, [loading, userId, weekNumber]);

  if (loading || busy) return <LoadingSpinner />;

  return (
    <main className="mx-auto max-w-lg p-4">
      <div className="mb-3 flex items-center justify-between">
  <button
    className="text-sm underline"
    onClick={() => router.push("/picks")}
  >
    ← Picks
  </button>
</div>

      <h1 className="text-xl font-semibold">
        {league?.name} • Week {weekNumber}
        {league && league.current_season_type === 1
          ? " (preseason test)"
          : league && league.current_season_type === 3
          ? " (postseason)"
          : ""}
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
        <p className="mt-1 text-xs text-gray-500">
          Picks turn green (win), red (loss) or amber (tie) as each game goes
          final. Uncolored means that game hasn’t finished yet.
        </p>

        {!weekCfg ? (
          <p className="mt-2 text-sm text-gray-600">No week config.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {roster.map((m) => {
              const isMe = m.user_id === userId;
              const picked = picksByUser.get(m.user_id);

              // Before reveal, only show your own picks; others show their
              // name (not secret) with picks hidden
              if (!revealed && !isMe) {
                return (
                  <div key={m.user_id} className="flex items-center justify-between rounded border p-3">
                    <div className="text-sm font-medium">{m.display_name || "Member"}</div>
                    <div className="text-sm text-gray-500">Hidden until kickoff</div>
                  </div>
                );
              }

              // After reveal (or if it's you), show picks, "Bye", or "No picks"
              const onBye = byeUserIds.has(m.user_id);
              const p1 = picked?.[1];
              const p2 = weekCfg.picks_required === 2 ? picked?.[2] : undefined;

              function teamPill(abbr: string | undefined, slot: 1 | 2) {
                if (!abbr) {
                  return (
                    <span className="text-gray-500 font-normal">No picks</span>
                  );
                }

                // Colored the moment that team's own game goes final; a pick
                // whose game hasn't finished stays neutral. Keyed on the team
                // too, so a stale result row can never color the wrong pick.
                const res =
                  resultByPick.get(keyPick(m.user_id, slot, abbr)) ?? "pending";

                const cls =
                  res === "win"
                    ? "inline-flex items-center gap-1.5 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 font-semibold text-emerald-800"
                    : res === "loss"
                    ? "inline-flex items-center gap-1.5 rounded border border-red-300 bg-red-50 px-2 py-1 font-semibold text-red-800"
                    : res === "push"
                    ? "inline-flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1 font-semibold text-amber-800"
                    : "inline-flex items-center gap-1.5 rounded border border-transparent px-2 py-1 font-semibold";

                return (
                  <span className={cls} title={`${abbr} • ${res}`}>
                    <TeamLogo abbr={abbr} size={16} />
                    {abbr}
                  </span>
                );
              }

              const right = onBye ? (
                <span className="text-gray-500 font-normal italic">Bye</span>
              ) : weekCfg.picks_required === 1 ? (
                teamPill(p1, 1)
              ) : (
                <span className="flex items-center gap-2">
                  {teamPill(p1, 1)}
                  {teamPill(p2, 2)}
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
