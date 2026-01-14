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
    .select("id,season_year,current_week")
    .eq("id", league_id)
    .single();

  if (error) throw error;
  if (!data) throw new Error("League not found");

  return {
    league_id: data.id as string,
    season_year: data.season_year as number,
    week_number: data.current_week as number,
  };
}

export async function POST(req: Request) {
  try {
    mustBeCron(req);

    const { league_id, season_year, week_number } =
      await getLeagueContextFromBody(req);

    // 1) Load all picks for this league/week
    const { data: allPicks, error: picksErr } = await supabaseAdmin
      .from("picks")
      .select("user_id,slot,team_abbr")
      .eq("league_id", league_id)
      .eq("season_year", season_year)
      .eq("week_number", week_number);

    if (picksErr) throw picksErr;

    // 2) Load games for THIS league/week + compute winners
    const { data: games, error: gamesErr } = await supabaseAdmin
      .from("games")
      .select("status,winner_abbr")
      .eq("league_id", league_id)
      .eq("season_year", season_year)
      .eq("week_number", week_number);

    if (gamesErr) throw gamesErr;

    const winners = new Set<string>();
    let allFinal = true;

    for (const g of games ?? []) {
      if (g.status !== "final") allFinal = false;
      if (g.winner_abbr) winners.add(g.winner_abbr);
    }

    const results = (allPicks ?? []).map((p: any) => {
      let result: "win" | "loss" | "pending" = "pending";
      if (allFinal) result = winners.has(p.team_abbr) ? "win" : "loss";

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

    // Clear then write for deterministic re-runs
    const { error: delErr } = await supabaseAdmin
      .from("pick_results")
      .delete()
      .eq("league_id", league_id)
      .eq("season_year", season_year)
      .eq("week_number", week_number);

    if (delErr) throw delErr;

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
      league_id,
      season_year,
      week_number,
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
