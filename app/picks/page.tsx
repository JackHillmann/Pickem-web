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

type WeekCfg = {
  picks_required: 1 | 2;
  lock_time: string; // timestamptz ISO
  reveal_time: string; // timestamptz ISO
};

type PickRow = {
  slot: 1 | 2;
  team_abbr: string;
};

type UsedPickRow = {
  week_number: number;
  team_abbr: string;
};

type GameRow = {
  kickoff_time: string;
  home_abbr: string;
  away_abbr: string;
  status?: string;
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

function fmtCountdown(ms: number) {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  return days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

export default function PicksPage() {
  const router = useRouter();
  const { userId, loading } = useRequireAuth();

  const [league, setLeague] = useState<League | null>(null);
  const [weekCfg, setWeekCfg] = useState<WeekCfg | null>(null);

  // Picks state (UI)
  const [picks, setPicks] = useState<{ 1: string; 2: string }>({
    1: "",
    2: "",
  });

  // Used teams: keep Set for filtering, plus rows for display (with week)
  const [usedTeams, setUsedTeams] = useState<Set<string>>(new Set());
  const [usedPickRows, setUsedPickRows] = useState<UsedPickRow[]>([]);

  // Bye state
  const [wantsBye, setWantsBye] = useState(false); // what UI is set to
  const [byeExistsThisWeek, setByeExistsThisWeek] = useState(false); // what's in DB
  const [byeUsedThisSeason, setByeUsedThisSeason] = useState(false); // any bye row this season

  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [msToLock, setMsToLock] = useState<number | null>(null);
  const [games, setGames] = useState<GameRow[]>([]);

  const locked = msToLock !== null ? msToLock <= 0 : false;

  const teamsPlaying = useMemo(() => {
    const s = new Set<string>();
    games.forEach((g) => {
      s.add(g.home_abbr);
      s.add(g.away_abbr);
    });

    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [games]);

  useEffect(() => {
    if (!weekCfg?.lock_time) {
      setMsToLock(null);
      return;
    }

    const lockAt = new Date(weekCfg.lock_time).getTime();

    const tick = () => {
      setMsToLock(lockAt - Date.now());
    };

    tick(); // set immediately on mount / week change
    const id = window.setInterval(tick, 1000);

    return () => window.clearInterval(id);
  }, [weekCfg?.lock_time]);

  useEffect(() => {
    if (loading) return;

    async function load() {
      setBusy(true);
      setErr(null);
      setMsg(null);

      // 1) Load league (first league for now)
      const { data: leagues, error: leaguesErr } = await supabase
        .from("leagues")
        .select("id,name,season_year,current_week,timezone")
        .limit(1);

      if (leaguesErr) {
        setErr(leaguesErr.message);
        setBusy(false);
        return;
      }
      if (!leagues || leagues.length === 0) {
        router.replace("/join");
        return;
      }

      const lg = leagues[0] as League;
      setLeague(lg);

      // 2) Load week config
      const { data: weekRows, error: weekErr } = await supabase
        .from("weeks")
        .select("picks_required,lock_time,reveal_time")
        .eq("league_id", lg.id)
        .eq("season_year", lg.season_year)
        .eq("week_number", lg.current_week)
        .limit(1);

      if (weekErr) {
        setErr(weekErr.message);
        setBusy(false);
        return;
      }
      if (!weekRows || weekRows.length === 0) {
        setErr(
          "Week config not found (weeks table). Add a row for this league/week."
        );
        setBusy(false);
        return;
      }

      const wc = weekRows[0] as WeekCfg;
      setWeekCfg(wc);
      // 3) Load NFL games for this week (GLOBAL games table)
      const { data: gameRows, error: gamesErr } = await supabase
        .from("games")
        .select("kickoff_time,home_abbr,away_abbr,status")
        .eq("season_year", lg.season_year)
        .eq("week_number", lg.current_week)
        .order("kickoff_time", { ascending: true });

      if (gamesErr) {
        setErr(gamesErr.message);
        setBusy(false);
        return;
      }

      setGames((gameRows ?? []) as GameRow[]);

      // 4) Load your picks for this week
      const { data: pickRows, error: picksErr } = await supabase
        .from("picks")
        .select("slot,team_abbr")
        .eq("league_id", lg.id)
        .eq("season_year", lg.season_year)
        .eq("week_number", lg.current_week)
        .eq("user_id", userId!)
        .order("slot", { ascending: true });

      if (picksErr) {
        setErr(picksErr.message);
        setBusy(false);
        return;
      }

      const nextPicks = { 1: "", 2: "" };
      (pickRows as PickRow[] | null)?.forEach(
        (r) => (nextPicks[r.slot] = r.team_abbr)
      );
      setPicks(nextPicks);

      // 5) Load used teams this season (for UI filtering) + include week_number for display
      const { data: usedRows, error: usedErr } = await supabase
        .from("picks")
        .select("team_abbr,week_number")
        .eq("league_id", lg.id)
        .eq("season_year", lg.season_year)
        .eq("user_id", userId!);

      if (usedErr) {
        setErr(usedErr.message);
        setBusy(false);
        return;
      }

      const used = new Set<string>();
      (usedRows ?? []).forEach((r: any) => used.add(r.team_abbr));
      setUsedTeams(used);

      setUsedPickRows((usedRows ?? []) as UsedPickRow[]);

      // 6) Load bye state
      const { data: byeThisWeek } = await supabase
        .from("byes")
        .select("id")
        .eq("league_id", lg.id)
        .eq("season_year", lg.season_year)
        .eq("week_number", lg.current_week)
        .eq("user_id", userId!)
        .limit(1);

      const exists = !!(byeThisWeek && byeThisWeek.length > 0);
      setByeExistsThisWeek(exists);
      setWantsBye(exists);

      const { data: byeSeason } = await supabase
        .from("byes")
        .select("id")
        .eq("league_id", lg.id)
        .eq("season_year", lg.season_year)
        .eq("user_id", userId!)
        .limit(1);

      setByeUsedThisSeason(!!(byeSeason && byeSeason.length > 0));

      setBusy(false);
    }

    load();
  }, [loading, router, userId]);

  function optionsFor(slot: 1 | 2) {
    // Only allow teams actually playing this week
    const pool = teamsPlaying; // no fallback

    const allowed = pool.filter((t) => {
      if (picks[slot] === t) return true; // allow current selection
      return !usedTeams.has(t); // block used teams
    });

    // Prevent duplicate picks
    return allowed.filter((t) =>
      slot === 1 ? t !== picks[2] : t !== picks[1]
    );
  }

  async function refreshUsedTeams() {
    if (!league) return;
    const { data: usedRows } = await supabase
      .from("picks")
      .select("team_abbr,week_number")
      .eq("league_id", league.id)
      .eq("season_year", league.season_year)
      .eq("user_id", userId!);

    const used = new Set<string>();
    (usedRows ?? []).forEach((r: any) => used.add(r.team_abbr));
    setUsedTeams(used);

    setUsedPickRows((usedRows ?? []) as UsedPickRow[]);
  }

  async function save() {
    if (!league || !weekCfg) return;

    setErr(null);
    setMsg(null);
    setSaving(true);

    // ---- BYE PATH ----
    if (wantsBye) {
      if (league.current_week > 16) {
        setSaving(false);
        setErr("Bye is only allowed in weeks 1–16.");
        return;
      }

      // Create bye (may error if already exists; ignore duplicate)
      const { error: byeErr } = await supabase.from("byes").insert({
        league_id: league.id,
        season_year: league.season_year,
        week_number: league.current_week,
        user_id: userId!,
      });

      if (byeErr && !byeErr.message.toLowerCase().includes("duplicate")) {
        setSaving(false);
        setErr(byeErr.message);
        return;
      }

      // Delete picks for the week
      const { error: delPicksErr } = await supabase
        .from("picks")
        .delete()
        .eq("league_id", league.id)
        .eq("season_year", league.season_year)
        .eq("week_number", league.current_week)
        .eq("user_id", userId!);

      if (delPicksErr) {
        setSaving(false);
        setErr(delPicksErr.message);
        return;
      }

      setByeExistsThisWeek(true);
      setByeUsedThisSeason(true);
      setPicks({ 1: "", 2: "" });

      await refreshUsedTeams();

      setSaving(false);
      setMsg("Saved (bye).");

      setTimeout(() => {}, 2000);
      return;
    }

    // ---- PICKS PATH ----
    // If bye exists in DB but user unchecked it, remove bye before saving picks
    if (byeExistsThisWeek) {
      const { error: delByeErr } = await supabase
        .from("byes")
        .delete()
        .eq("league_id", league.id)
        .eq("season_year", league.season_year)
        .eq("week_number", league.current_week)
        .eq("user_id", userId!);

      if (delByeErr) {
        setSaving(false);
        setErr(delByeErr.message);
        return;
      }
      setByeExistsThisWeek(false);

      // re-check whether bye is used elsewhere
      const { data: byeSeason } = await supabase
        .from("byes")
        .select("id")
        .eq("league_id", league.id)
        .eq("season_year", league.season_year)
        .eq("user_id", userId!)
        .limit(1);

      setByeUsedThisSeason(!!(byeSeason && byeSeason.length > 0));
    }

    const required = weekCfg.picks_required;
    const slot1 = picks[1].trim();
    const slot2 = picks[2].trim();

    if (!slot1) {
      setSaving(false);
      setErr("Pick 1 is required.");
      return;
    }
    if (required === 2 && !slot2) {
      setSaving(false);
      setErr("Pick 2 is required.");
      return;
    }
    if (required === 2 && slot1 === slot2) {
      setSaving(false);
      setErr("Pick 1 and Pick 2 must be different teams.");
      return;
    }

    const rows: any[] = [
      {
        league_id: league.id,
        season_year: league.season_year,
        week_number: league.current_week,
        user_id: userId!,
        slot: 1,
        team_abbr: slot1,
      },
    ];

    if (required === 2) {
      rows.push({
        league_id: league.id,
        season_year: league.season_year,
        week_number: league.current_week,
        user_id: userId!,
        slot: 2,
        team_abbr: slot2,
      });
    }

    const { error: upErr } = await supabase.from("picks").upsert(rows, {
      onConflict: "league_id,season_year,week_number,user_id,slot",
    });

    if (upErr) {
      setSaving(false);
      setErr(upErr.message);
      return;
    }

    // If 1-pick week, remove slot 2 if it exists
    if (required === 1) {
      await supabase
        .from("picks")
        .delete()
        .eq("league_id", league.id)
        .eq("season_year", league.season_year)
        .eq("week_number", league.current_week)
        .eq("user_id", userId!)
        .eq("slot", 2);
    }

    await refreshUsedTeams();

    setSaving(false);
    setMsg("Saved.");
  }

  if (loading || busy) return null;

  return (
    <main className="mx-auto max-w-lg p-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{league?.name}</h1>
          <p className="text-sm text-gray-600">
            Week {league?.current_week} • Season {league?.season_year}
          </p>
          {weekCfg && (
            <p className="mt-1 text-xs text-gray-500">
              Locks & Reveals: {fmt(weekCfg.lock_time)}
            </p>
          )}
        </div>
        <button
          className="text-sm text-gray-900 underline dark:text-zinc-100"
          onClick={() => router.push("/")}
        >
          ← Home
        </button>
        <button
          className="rounded border px-3 py-2 text-sm"
          onClick={async () => {
            await supabase.auth.signOut();
            router.push("/login");
          }}
        >
          Sign out
        </button>
      </header>

      {/* Bye selection */}
      {weekCfg && (
        <section className="mt-4 rounded border p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Bye week</h2>
              <p className="mt-1 text-xs text-gray-500">
                You can use 1 bye per season (weeks 1–16 only). Selecting a bye
                means you make no picks this week.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={wantsBye}
                disabled={
                  locked ||
                  league!.current_week > 16 ||
                  (byeUsedThisSeason && !byeExistsThisWeek)
                }
                onChange={(e) => {
                  const checked = e.target.checked;
                  setWantsBye(checked);
                  if (checked) setPicks({ 1: "", 2: "" });
                }}
              />
              Use bye
            </label>
          </div>

          {league!.current_week > 16 && (
            <p className="mt-2 text-xs text-gray-600">
              Bye is not available in weeks 17–18.
            </p>
          )}
          {byeUsedThisSeason && !byeExistsThisWeek && (
            <p className="mt-2 text-xs text-gray-600">
              You already used your bye this season.
            </p>
          )}
        </section>
      )}

      {err && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {/* Picks */}
      {weekCfg && (
        <section className="mt-4 rounded border p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Your picks</h2>
              {!locked && weekCfg && msToLock !== null && (
                <p className="mt-1 text-xs text-gray-500">
                  Edits close in{" "}
                  <span className="font-medium">{fmtCountdown(msToLock)}</span>
                </p>
              )}

              {locked && weekCfg && (
                <p className="mt-1 text-xs text-gray-500">
                  Locked at{" "}
                  <span className="font-medium">{fmt(weekCfg.lock_time)}</span>
                </p>
              )}
            </div>

            {locked ? (
              <span className="inline-flex items-center rounded-full bg-red-600 px-2 py-1 text-xs font-semibold text-white ring-1 ring-red-400/50">
                Locked
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-emerald-600 px-2 py-1 text-xs font-semibold text-white">
                Open
              </span>
            )}
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Pick 1</label>
              <select
                className="w-full rounded border p-3"
                value={picks[1]}
                disabled={locked || wantsBye}
                onChange={(e) => setPicks((p) => ({ ...p, 1: e.target.value }))}
              >
                <option value="">
                  {wantsBye
                    ? "Bye selected - Click `Save Picks to Confirm`"
                    : "Select a team"}
                </option>
                {!wantsBye &&
                  optionsFor(1).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
              </select>
            </div>

            {weekCfg.picks_required === 2 && (
              <div>
                <label className="mb-1 block text-sm font-medium">Pick 2</label>
                <select
                  className="w-full rounded border p-3"
                  value={picks[2]}
                  disabled={locked || wantsBye}
                  onChange={(e) =>
                    setPicks((p) => ({ ...p, 2: e.target.value }))
                  }
                >
                  <option value="">
                    {wantsBye
                      ? "Bye selected - Click `Save Picks to Confirm`"
                      : "Select a team"}
                  </option>
                  {!wantsBye &&
                    optionsFor(2).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                </select>
              </div>
            )}

            <button
              className="w-full rounded border p-3"
              disabled={locked || saving}
              onClick={save}
            >
              {saving ? "Saving..." : "Save picks"}
            </button>

            {msg && <p className="text-sm text-green-700">{msg}</p>}

            <button
              className="w-full rounded border p-3"
              onClick={() => router.push(`/week/${league?.current_week}`)}
            >
              View week page
            </button>
            <button
              className="w-full rounded border p-3"
              onClick={() => router.push("/standings")}
            >
              View standings
            </button>
          </div>
        </section>
      )}

      {/* Used teams */}
      <section className="mt-4 rounded border p-4">
        <h2 className="text-base font-semibold">Used teams (season)</h2>
        <p className="mt-1 text-xs text-gray-500">
          You can’t pick a team more than once all season.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {usedPickRows
            .slice()
            .sort(
              (a, b) =>
                a.week_number - b.week_number ||
                a.team_abbr.localeCompare(b.team_abbr)
            )
            .map((r, idx) => (
              <span
                key={`${r.week_number}-${r.team_abbr}-${idx}`}
                className="rounded border px-2 py-1 text-xs"
                title={`Week ${r.week_number}`}
              >
                W{r.week_number} {r.team_abbr}
              </span>
            ))}

          {usedPickRows.length === 0 && (
            <span className="text-sm text-gray-500">None yet</span>
          )}
        </div>
      </section>
    </main>
  );
}
