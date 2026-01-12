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

    // ---- TEMP STUB (we'll replace with real API soon) ----
    const fakeGames = [
      {
        game_id: "game1",
        home_abbr: "BUF",
        away_abbr: "NYJ",
        kickoff_time: "2026-09-10T00:20:00Z", // Thu night
      },
      {
        game_id: "game2",
        home_abbr: "DAL",
        away_abbr: "PHI",
        kickoff_time: "2026-09-11T18:00:00Z",
      },
    ];
    // -----------------------------------------------------

    // earliest kickoff
    const reveal = Math.min(
      ...fakeGames.map((g) => new Date(g.kickoff_time).getTime())
    );
    const revealIso = new Date(reveal).toISOString();

    const picks_required = week_number >= 17 ? 1 : 2;

    // Upsert week config
    const { error: weekErr } = await supabaseAdmin
      .from("weeks")
      .upsert(
        {
          league_id,
          season_year,
          week_number,
          picks_required,
          lock_time: revealIso,
          reveal_time: revealIso,
        },
        { onConflict: "league_id,season_year,week_number" }
      );

    if (weekErr) throw weekErr;

    // Upsert games
    const rows = fakeGames.map((g) => ({
      league_id,
      season_year,
      week_number,
      provider: "stub",
      game_id: g.game_id,
      home_abbr: g.home_abbr,
      away_abbr: g.away_abbr,
      kickoff_time: g.kickoff_time,
      status: "scheduled",
      home_score: null,
      away_score: null,
      winner_abbr: null,
    }));

    const { error: gameErr } = await supabaseAdmin
      .from("games")
      .upsert(rows, { onConflict: "league_id,season_year,game_id" });

    if (gameErr) throw gameErr;

    return NextResponse.json({
      ok: true,
      reveal_time: revealIso,
      games: rows.length,
    });
} catch (e: any) {
  console.error("grade-week error:", e);
  return NextResponse.json(
    { error: e?.message ?? String(e) },
    { status: e?.message === "Unauthorized" ? 401 : 500 }
  );
}
}
