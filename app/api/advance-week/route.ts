import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabaseAdmin";

function mustBeCron(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const hasSecret =
    req.headers.get("x-cron-secret") === process.env.CRON_SECRET;
  if (!isVercelCron && !hasSecret) throw new Error("Unauthorized");
}

async function getLeagueById(league_id: string) {
  const { data, error } = await supabaseAdmin
    .from("leagues")
    .select("id,name,season_year,current_week")
    .eq("id", league_id)
    .single();

  if (error) throw error;
  if (!data) throw new Error("League not found");

  return data as {
    id: string;
    name: string;
    season_year: number;
    current_week: number;
  };
}

function mapStatus(
  state: string | undefined
): "scheduled" | "inprogress" | "final" {
  if (state === "in") return "inprogress";
  if (state === "post") return "final";
  return "scheduled";
}

async function fetchEspnScoreboard(params: {
  season_year: number;
  week_number: number;
  season_type: number;
}) {
  const { season_year, week_number, season_type } = params;

  const url = new URL(
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
  );
  url.searchParams.set("seasontype", String(season_type));
  url.searchParams.set("week", String(week_number));
  url.searchParams.set("dates", String(season_year));

  const r = await fetch(url.toString(), {
    headers: { accept: "application/json" },
    cache: "no-store",
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return { ok: false as const, status: r.status, error: t || "ESPN error" };
  }

  const json: any = await r.json().catch(() => ({}));
  const events: any[] = json.events ?? [];
  return { ok: true as const, events };
}

async function syncGamesInline(args: {
  league_id: string;
  season_year: number;
  week_number: number;
  season_type: number;
  provider?: string;
}) {
  const provider = args.provider ?? "espn";

  const espn = await fetchEspnScoreboard({
    season_year: args.season_year,
    week_number: args.week_number,
    season_type: args.season_type,
  });

  if (!espn.ok) {
    return {
      ok: false as const,
      reason: "ESPN fetch failed; will retry later",
      espn_status: espn.status,
      espn_error: espn.error,
      upserted: 0,
    };
  }

  const rows: any[] = [];
  for (const ev of espn.events) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;

    const competitors = comp.competitors ?? [];
    const home = competitors.find((c: any) => c.homeAway === "home");
    const away = competitors.find((c: any) => c.homeAway === "away");
    if (!home?.team?.abbreviation || !away?.team?.abbreviation) continue;

    const home_abbr = home.team.abbreviation;
    const away_abbr = away.team.abbreviation;

    const statusType = comp.status?.type;
    const state = statusType?.state; // pre / in / post
    const completed = !!statusType?.completed;

    const status = mapStatus(state);
    const kickoff_time = comp.date;

    const home_score = home.score != null ? Number(home.score) : null;
    const away_score = away.score != null ? Number(away.score) : null;

    let winner_abbr: string | null = null;
    if (completed && home_score != null && away_score != null) {
      if (home_score > away_score) winner_abbr = home_abbr;
      else if (away_score > home_score) winner_abbr = away_abbr;
    }

    rows.push({
      league_id: args.league_id,
      season_year: args.season_year,
      week_number: args.week_number,
      provider,
      game_id: String(ev.id),
      home_abbr,
      away_abbr,
      kickoff_time,
      status,
      home_score,
      away_score,
      winner_abbr,
    });
  }

  if (rows.length === 0) {
    return {
      ok: false as const,
      reason: "ESPN returned 0 events; will retry later",
      upserted: 0,
    };
  }

  const { error: upErr } = await supabaseAdmin
    .from("games")
    .upsert(rows, { onConflict: "league_id,season_year,game_id" });

  if (upErr) throw upErr;

  return { ok: true as const, upserted: rows.length };
}

async function syncWeekInline(args: {
  league_id: string;
  season_year: number;
  week_number: number;
}) {
  // picks_required rule as you had it
  const picks_required = args.week_number >= 17 ? 1 : 2;

  const { data: games, error: gamesErr } = await supabaseAdmin
    .from("games")
    .select("kickoff_time")
    .eq("league_id", args.league_id)
    .eq("season_year", args.season_year)
    .eq("week_number", args.week_number)
    .order("kickoff_time", { ascending: true })
    .limit(1);

  if (gamesErr) throw gamesErr;

  if (!games?.length) {
    return {
      ok: false as const,
      reason: "No games found in DB for league/week; will retry later",
    };
  }

  const lockIso = new Date(games[0].kickoff_time).toISOString();
  const revealIso = lockIso;

  const { error: weekErr } = await supabaseAdmin.from("weeks").upsert(
    {
      league_id: args.league_id,
      season_year: args.season_year,
      week_number: args.week_number,
      picks_required,
      lock_time: lockIso,
      reveal_time: revealIso,
    },
    { onConflict: "league_id,season_year,week_number" }
  );

  if (weekErr) throw weekErr;

  return {
    ok: true as const,
    picks_required,
    lock_time: lockIso,
    reveal_time: revealIso,
  };
}

export async function POST(req: Request) {
  try {
    mustBeCron(req);

    const body = await req.json().catch(() => ({} as any));
    const league_id = String(body.league_id ?? "").trim();
    if (!league_id) {
      return NextResponse.json({ error: "Missing league_id" }, { status: 400 });
    }

    const season_type = Number(body.season_type ?? 2);
    const lg = await getLeagueById(league_id);

    if (lg.current_week >= 18) {
      return NextResponse.json({
        ok: true,
        league_id,
        advanced: false,
        reason: "Already week 18",
        season_year: lg.season_year,
        current_week: lg.current_week,
      });
    }

    // Check current week games all final
    const { data: curGames, error: curGamesErr } = await supabaseAdmin
      .from("games")
      .select("status")
      .eq("league_id", league_id)
      .eq("season_year", lg.season_year)
      .eq("week_number", lg.current_week);

    if (curGamesErr) throw curGamesErr;

    const count = (curGames ?? []).length;
    const allFinal =
      count > 0 && (curGames ?? []).every((g: any) => g.status === "final");

    if (!allFinal) {
      return NextResponse.json({
        ok: true,
        league_id,
        advanced: false,
        reason:
          count === 0
            ? "No games found for current week"
            : "Not all games final",
        season_year: lg.season_year,
        current_week: lg.current_week,
        games_found: count,
      });
    }

    const next_week = lg.current_week + 1;

    // Provider check for next week (retry-later, not 500)
    const provider = await fetchEspnScoreboard({
      season_year: lg.season_year,
      week_number: next_week,
      season_type,
    });

    if (!provider.ok) {
      return NextResponse.json({
        ok: true,
        league_id,
        advanced: false,
        reason: "Provider check failed; will retry later",
        season_year: lg.season_year,
        from_week: lg.current_week,
        to_week: next_week,
        season_type,
        provider_status: provider.status,
        provider_error: provider.error,
      });
    }

    if ((provider.events ?? []).length === 0) {
      return NextResponse.json({
        ok: true,
        league_id,
        advanced: false,
        reason: "Next week has no games at provider (ESPN) — not advancing",
        season_year: lg.season_year,
        from_week: lg.current_week,
        to_week: next_week,
        season_type,
      });
    }

    // 1) Sync games inline
    const sg = await syncGamesInline({
      league_id,
      season_year: lg.season_year,
      week_number: next_week,
      season_type,
    });

    if (!sg.ok) {
      return NextResponse.json({
        ok: true,
        league_id,
        advanced: false,
        reason: sg.reason,
        season_year: lg.season_year,
        from_week: lg.current_week,
        to_week: next_week,
        season_type,
        sync_games: sg,
      });
    }

    // 2) Sync week inline
    const sw = await syncWeekInline({
      league_id,
      season_year: lg.season_year,
      week_number: next_week,
    });

    if (!sw.ok) {
      return NextResponse.json({
        ok: true,
        league_id,
        advanced: false,
        reason: sw.reason,
        season_year: lg.season_year,
        from_week: lg.current_week,
        to_week: next_week,
        season_type,
        sync_week: sw,
      });
    }

    // 3) Advance league week
    const { error: updErr } = await supabaseAdmin
      .from("leagues")
      .update({ current_week: next_week })
      .eq("id", league_id);

    if (updErr) throw updErr;

    return NextResponse.json({
      ok: true,
      league_id,
      name: lg.name,
      advanced: true,
      season_year: lg.season_year,
      season_type,
      from_week: lg.current_week,
      to_week: next_week,
      sync_games: sg,
      sync_week: sw,
    });
  } catch (e: any) {
    console.error("advance-week error:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e) },
      { status: e?.message === "Unauthorized" ? 401 : 500 }
    );
  }
}
