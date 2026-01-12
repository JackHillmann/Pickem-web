import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabaseAdmin";

function mustBeCron(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const hasSecret = req.headers.get("x-cron-secret") === process.env.CRON_SECRET;
  if (!isVercelCron && !hasSecret) throw new Error("Unauthorized");
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
    mustBeCron(req);

    const { league_id, season_year, week_number } = await getLeagueContext();

    // picks required: 2 for weeks 1-16, 1 for 17-18 (your existing rule)
    const picks_required = week_number >= 17 ? 1 : 2;

    // Pull earliest kickoff from GLOBAL games table (synced by /api/sync-games)
    const { data: games, error: gamesErr } = await supabaseAdmin
      .from("games")
      .select("kickoff_time")
      .eq("season_year", season_year)
      .eq("week_number", week_number)
      .order("kickoff_time", { ascending: true })
      .limit(1);

    if (gamesErr) throw gamesErr;

    // Fallback if games aren't synced yet
    const lockIso = games?.[0]?.kickoff_time
      ? new Date(games[0].kickoff_time).toISOString()
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // +24h fallback

    const revealIso = lockIso; // keep same for now (you can change later)

    // Upsert week config
    const { error: weekErr } = await supabaseAdmin
      .from("weeks")
      .upsert(
        {
          league_id,
          season_year,
          week_number,
          picks_required,
          lock_time: lockIso,
          reveal_time: revealIso,
        },
        { onConflict: "league_id,season_year,week_number" }
      );

    if (weekErr) throw weekErr;

    return NextResponse.json({
      ok: true,
      week_number,
      picks_required,
      lock_time: lockIso,
      reveal_time: revealIso,
      note: games?.length ? "lock set from games table" : "no games found; used fallback lock time",
    });
  } catch (e: any) {
    console.error("sync-week error:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e) },
      { status: e?.message === "Unauthorized" ? 401 : 500 }
    );
  }
}
