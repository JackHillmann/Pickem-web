import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabaseAdmin";

function mustBeCron(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const hasSecret =
    req.headers.get("x-cron-secret") === process.env.CRON_SECRET;
  if (!isVercelCron && !hasSecret) throw new Error("Unauthorized");
}

async function getLeagueContextById(league_id: string) {
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

    const body = await req.json().catch(() => ({} as any));

    const league_id = String(body.league_id ?? "").trim();
    if (!league_id) {
      return NextResponse.json({ error: "Missing league_id" }, { status: 400 });
    }

    const ctx = await getLeagueContextById(league_id);

    // Optional overrides (handy for testing), otherwise uses league context
    const season_year = Number(body.season_year ?? ctx.season_year);
    const week_number = Number(body.week_number ?? ctx.week_number);

    // Only allow the old "+24h fallback" behavior if explicitly requested
    const allow_fallback_lock = Boolean(body.allow_fallback_lock ?? false);

    // Keep your existing rule (adjust if playoffs differ)
    const picks_required = week_number >= 17 ? 1 : 2;

    // Find earliest kickoff for THIS league/week
    const { data: games, error: gamesErr } = await supabaseAdmin
      .from("games")
      .select("kickoff_time")
      .eq("league_id", ctx.league_id)
      .eq("season_year", season_year)
      .eq("week_number", week_number)
      .order("kickoff_time", { ascending: true })
      .limit(1);

    if (gamesErr) throw gamesErr;

    // If no games exist, refuse to create config unless fallback is allowed
    if (!games?.length && !allow_fallback_lock) {
      return NextResponse.json(
        {
          error:
            "No games found for league/week; refusing to create week config. Run sync-games first, or pass allow_fallback_lock:true if you really want a fallback.",
          league_id: ctx.league_id,
          season_year,
          week_number,
        },
        { status: 409 }
      );
    }

    const lockIso = games?.[0]?.kickoff_time
      ? new Date(games[0].kickoff_time).toISOString()
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // fallback only if allowed

    const revealIso = lockIso;

    const { error: weekErr } = await supabaseAdmin.from("weeks").upsert(
      {
        league_id: ctx.league_id,
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
      league_id: ctx.league_id,
      season_year,
      week_number,
      picks_required,
      lock_time: lockIso,
      reveal_time: revealIso,
      note: games?.length
        ? "lock set from games table"
        : "no games found; used fallback lock time (allow_fallback_lock=true)",
    });
  } catch (e: any) {
    console.error("sync-week error:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e) },
      { status: e?.message === "Unauthorized" ? 401 : 500 }
    );
  }
}
