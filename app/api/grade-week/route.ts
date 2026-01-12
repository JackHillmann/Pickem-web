import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabaseAdmin";

function mustBeCron(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    throw new Error("Unauthorized");
  }
}
async function getLeagueContext() {
  const { data, error } = await supabaseAdmin
    .from("leagues")
    .select("id,season_year,current_week")
    .limit(1)
    .single();

  if (error) throw error;
  if (!data) throw new Error("League not found");

  return {
    league_id: data.id,
    season_year: data.season_year,
    week_number: data.current_week,
  };
}

// TEMP: stub results for the stub games created by sync-week
const stubResults = [
  { game_id: "game1", status: "final" as const, home_score: 24, away_score: 20 },
  { game_id: "game2", status: "final" as const, home_score: 17, away_score: 28 },
];

export async function POST(req: Request) {
  try {
    function mustBeCron(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const hasSecret = req.headers.get("x-cron-secret") === process.env.CRON_SECRET;

  if (!isVercelCron && !hasSecret) {
    throw new Error("Unauthorized");
  }
}

const { league_id, season_year, week_number } = await getLeagueContext();
    if (!league_id || !season_year || !week_number) {
      return NextResponse.json(
        { error: "Missing league_id / season_year / week_number" },
        { status: 400 }
      );
    }

    // ---- 1) Load existing games (teams) so we can compute winner_abbr ----
    const { data: existingGames, error: loadErr } = await supabaseAdmin
      .from("games")
      .select("game_id,home_abbr,away_abbr")
      .eq("league_id", league_id)
      .eq("season_year", season_year)
      .eq("week_number", week_number);

    if (loadErr) throw loadErr;

    const teamByGameId = new Map<string, { home: string; away: string }>();
    (existingGames ?? []).forEach((g: any) => {
      teamByGameId.set(g.game_id, { home: g.home_abbr, away: g.away_abbr });
    });

    // ---- 2) Compute updates for games table ----
    const gameUpdates = stubResults.map((r) => {
      const teams = teamByGameId.get(r.game_id);

      const winner_abbr =
        teams && r.status === "final"
          ? r.home_score === r.away_score
            ? null
            : r.home_score > r.away_score
            ? teams.home
            : teams.away
          : null;

      return {
        game_id: r.game_id,
        status: r.status,
        home_score: r.home_score,
        away_score: r.away_score,
        winner_abbr,
      };
    });

    // ---- 3) Update games (UPDATE, not UPSERT) ----
    for (const u of gameUpdates) {
      const { error: updErr } = await supabaseAdmin
        .from("games")
        .update({
          status: u.status,
          home_score: u.home_score,
          away_score: u.away_score,
          winner_abbr: u.winner_abbr,
        })
        .eq("league_id", league_id)
        .eq("season_year", season_year)
        .eq("game_id", u.game_id);

      if (updErr) throw updErr;
    }

    // ---- 4) Grade picks -> write pick_results ----

    // 4a) Load all picks for this week
    const { data: allPicks, error: picksErr } = await supabaseAdmin
      .from("picks")
      .select("user_id,slot,team_abbr")
      .eq("league_id", league_id)
      .eq("season_year", season_year)
      .eq("week_number", week_number);

    if (picksErr) throw picksErr;

    // 4b) Load games (winner/status) for this week
    const { data: finalGames, error: finalErr } = await supabaseAdmin
      .from("games")
      .select("winner_abbr,status")
      .eq("league_id", league_id)
      .eq("season_year", season_year)
      .eq("week_number", week_number);

    if (finalErr) throw finalErr;

    const winners = new Set<string>();
    let allFinal = true;

    for (const g of finalGames ?? []) {
      if (g.status !== "final") allFinal = false;
      if (g.winner_abbr) winners.add(g.winner_abbr);
    }

    const results = (allPicks ?? []).map((p: any) => {
      let result: "win" | "loss" | "pending" = "pending";
      if (allFinal) {
        result = winners.has(p.team_abbr) ? "win" : "loss";
      }
      return {
        league_id,
        season_year,
        week_number,
        user_id: p.user_id,
        slot: p.slot,
        team_abbr: p.team_abbr,
        result,
      };
    });

    if (results.length > 0) {
      const { error: prErr } = await supabaseAdmin
        .from("pick_results")
        .upsert(results, {
          onConflict: "league_id,season_year,week_number,user_id,slot",
        });

      if (prErr) throw prErr;
    }

    return NextResponse.json({
      ok: true,
      gamesUpdated: gameUpdates.length,
      picksFound: allPicks?.length ?? 0,
      gamesFound: finalGames?.length ?? 0,
      resultsWritten: results.length,
      allFinal,
    });
  } catch (e: any) {
    console.error("grade-week error:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e) },
      { status: e?.message === "Unauthorized" ? 401 : 500 }
    );
  }
}
