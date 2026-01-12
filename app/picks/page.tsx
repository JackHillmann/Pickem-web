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
  lock_time: string;   // timestamptz ISO
  reveal_time: string; // timestamptz ISO
};

type PickRow = {
  slot: 1 | 2;
  team_abbr: string;
};

const NFL_TEAMS = [
  "ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB",
  "HOU","IND","JAX","KC","LV","LAC","LAR","MIA","MIN","NE","NO","NYG","NYJ",
  "PHI","PIT","SEA","SF","TB","TEN","WAS"
];

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

export default function PicksPage() {
  const router = useRouter();
  const { userId, loading } = useRequireAuth();

  const [league, setLeague] = useState<League | null>(null);
  const [weekCfg, setWeekCfg] = useState<WeekCfg | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Picks state (UI)
  const [picks, setPicks] = useState<{ 1: string; 2: string }>({ 1: "", 2: "" });
  const [usedTeams, setUsedTeams] = useState<Set<string>>(new Set());

  // Bye state
  const [wantsBye, setWantsBye] = useState(false);        // what UI is set to
  const [byeExistsThisWeek, setByeExistsThisWeek] = useState(false); // what's in DB
  const [byeUsedThisSeason, setByeUsedThisSeason] = useState(false); // any bye row this season

  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const locked = useMemo(() => {
    if (!weekCfg) return false;
    return Date.now() >= new Date(weekCfg.lock_time).getTime();
  }, [weekCfg]);

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
        setErr("Week config not found (weeks table). Add a row for this league/week.");
        setBusy(false);
        return;
      }

      const wc = weekRows[0] as WeekCfg;
      setWeekCfg(wc);

      // 3) Load your display name
      const { data: meRow, error: meErr } = await supabase
        .from("league_members")
        .select("display_name")
        .eq("league_id", lg.id)
        .eq("user_id", userId!)
        .single();

      if (!meErr) setDisplayName(meRow?.display_name ?? "");

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
      (pickRows as PickRow[] | null)?.forEach((r) => (nextPicks[r.slot] = r.team_abbr));
      setPicks(nextPicks);

      // 5) Load used teams this season (for UI filtering)
      const { data: usedRows, error: usedErr } = await supabase
        .from("picks")
        .select("team_abbr")
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
    const allowed = NFL_TEAMS.filter((t) => {
      if (picks[slot] === t) return true;
      return !usedTeams.has(t);
    });

    return allowed.filter((t) => (slot === 1 ? t !== picks[2] : t !== picks[1]));
  }

  async function refreshUsedTeams() {
    if (!league) return;
    const { data: usedRows } = await supabase
      .from("picks")
      .select("team_abbr")
      .eq("league_id", league.id)
      .eq("season_year", league.season_year)
      .eq("user_id", userId!);

    const used = new Set<string>();
    (usedRows ?? []).forEach((r: any) => used.add(r.team_abbr));
    setUsedTeams(used);
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

    const { error: upErr } = await supabase
      .from("picks")
      .upsert(rows, { onConflict: "league_id,season_year,week_number,user_id,slot" });

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
              Locks: {fmt(weekCfg.lock_time)} • Reveals: {fmt(weekCfg.reveal_time)}
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

      {/* Display name */}
      <section className="mt-4 rounded border p-4">
        <h2 className="text-base font-semibold">Display name</h2>
        <p className="mt-1 text-xs text-gray-500">
          This is what other players will see after picks are revealed.
        </p>

        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded border p-3"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Ex: Jack"
          />
          <button
            className="rounded bg-black px-4 py-3 text-white disabled:opacity-50"
            disabled={savingName || !displayName.trim()}
            onClick={async () => {
              setSavingName(true);
              const { error } = await supabase
                .from("league_members")
                .update({ display_name: displayName.trim() })
                .eq("league_id", league!.id)
                .eq("user_id", userId!);

              setSavingName(false);
              if (error) alert(error.message);
            }}
          >
            {savingName ? "Saving..." : "Save"}
          </button>
        </div>
      </section>

      {/* Bye selection */}
      {weekCfg && (
        <section className="mt-4 rounded border p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Bye week</h2>
              <p className="mt-1 text-xs text-gray-500">
                You can use 1 bye per season (weeks 1–16 only). Selecting a bye means you make no picks this week.
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
            <p className="mt-2 text-xs text-gray-600">Bye is not available in weeks 17–18.</p>
          )}
          {byeUsedThisSeason && !byeExistsThisWeek && (
            <p className="mt-2 text-xs text-gray-600">You already used your bye this season.</p>
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
            <h2 className="text-base font-semibold">Your picks</h2>
            {locked ? (
              <span className="inline-flex items-center rounded-full bg-zinc-800 px-2 py-1 text-xs font-semibold text-white ring-1 ring-white/10"
>Locked</span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-emerald-600 px-2 py-1 text-xs font-semibold text-white"
>Open</span>
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
                <option value="">{wantsBye ? "Bye selected - Click `Save Picks to Confirm`" : "Select a team"}</option>
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
                  onChange={(e) => setPicks((p) => ({ ...p, 2: e.target.value }))}
                >
                  <option value="">{wantsBye ? "Bye selected - Click `Save Picks to Confirm`" : "Select a team"}</option>
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
              className="w-full rounded bg-black p-3 text-white disabled:opacity-50"
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
          {[...usedTeams].sort().map((t) => (
            <span key={t} className="rounded border px-2 py-1 text-xs">
              {t}
            </span>
          ))}
          {usedTeams.size === 0 && <span className="text-sm text-gray-500">None yet</span>}
        </div>
      </section>
    </main>
  );
}
