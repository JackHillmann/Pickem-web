import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabaseAdmin";

function mustBeCron(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const hasSecret =
    req.headers.get("x-cron-secret") === process.env.CRON_SECRET;
  if (!isVercelCron && !hasSecret) throw new Error("Unauthorized");
}

async function getLeagueContextFromBody(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const league_id = String(body.league_id ?? "").trim();
  if (!league_id) throw new Error("Missing league_id");

  const { data, error } = await supabaseAdmin
    .from("leagues")
    .select("id,season_year,current_week,current_season_type")
    .eq("id", league_id)
    .single();

  if (error) throw error;
  if (!data) throw new Error("League not found");

  return {
    league_id: data.id as string,
    season_year: data.season_year as number,
    week_number: data.current_week as number,
    season_type: data.current_season_type as number,
  };
}

export async function POST(req: Request) {
  try {
    mustBeCron(req);

    const { league_id, season_year, week_number, season_type } =
      await getLeagueContextFromBody(req);

    // 1) Load all picks for this league/week
    const { data: allPicks, error: picksErr } = await supabaseAdmin
      .from("picks")
      .select("user_id,slot,team_abbr")
      .eq("league_id", league_id)
      .eq("season_year", season_year)
      .eq("week_number", week_number)
      .eq("season_type", season_type);

    if (picksErr) throw picksErr;

    // 2) Load games for THIS league/week + compute winners
    const { data: games, error: gamesErr } = await supabaseAdmin
      .from("games")
      .select("status,home_abbr,away_abbr,winner_abbr")
      .eq("league_id", league_id)
      .eq("season_year", season_year)
      .eq("week_number", week_number)
      .eq("season_type", season_type);

    if (gamesErr) throw gamesErr;

    // Each pick is graded against its own game only — a team's game being
    // final doesn't depend on any other game in the week having finished.
    const finalTeams = new Set<string>();
    const winners = new Set<string>();
    let allFinal = true;

    for (const g of games ?? []) {
      if (g.status !== "final") {
        allFinal = false;
        continue;
      }
      if (g.home_abbr) finalTeams.add(g.home_abbr);
      if (g.away_abbr) finalTeams.add(g.away_abbr);
      if (g.winner_abbr) winners.add(g.winner_abbr);
    }

    const results = (allPicks ?? []).map((p: any) => {
      let result: "win" | "loss" | "pending" = "pending";
      if (finalTeams.has(p.team_abbr)) {
        result = winners.has(p.team_abbr) ? "win" : "loss";
      }

      return {
        league_id,
        season_year,
        week_number,
        season_type,
        user_id: p.user_id,
        slot: p.slot,
        team_abbr: p.team_abbr,
        result,
      };
    });

    // Clear then write for deterministic re-runs
    const { error: delErr } = await supabaseAdmin
      .from("pick_results")
      .delete()
      .eq("league_id", league_id)
      .eq("season_year", season_year)
      .eq("week_number", week_number)
      .eq("season_type", season_type);

    if (delErr) throw delErr;

    if (results.length > 0) {
      const { error: prErr } = await supabaseAdmin
        .from("pick_results")
        .upsert(results, {
          onConflict: "league_id,season_year,season_type,week_number,user_id,slot",
        });
      if (prErr) throw prErr;
    }

    return NextResponse.json({
      ok: true,
      league_id,
      season_year,
      week_number,
      season_type,
      picksFound: allPicks?.length ?? 0,
      gamesFound: games?.length ?? 0,
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
