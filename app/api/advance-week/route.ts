import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabaseAdmin";

function mustBeCron(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const hasSecret =
    req.headers.get("x-cron-secret") === process.env.CRON_SECRET;
  if (!isVercelCron && !hasSecret) throw new Error("Unauthorized");
}

function getBaseUrl(req: Request) {
  // Prefer explicit APP_URL if you set it (recommended)
  if (process.env.APP_URL) return process.env.APP_URL;

  // Vercel provides VERCEL_URL without protocol
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  // Fallback for local dev
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

async function postJson(baseUrl: string, path: string, body: any) {
  const r = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cron-secret": process.env.CRON_SECRET ?? "",
    },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
  });

  const text = await r.text();
  if (!r.ok) throw new Error(`${path} failed: ${r.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

export async function POST(req: Request) {
  try {
    mustBeCron(req);

    const baseUrl = getBaseUrl(req);

    // Get leagues (support multiple leagues safely)
    const { data: leagues, error: leaguesErr } = await supabaseAdmin
      .from("leagues")
      .select("id,name,season_year,current_week")
      .order("created_at", { ascending: true });

    if (leaguesErr) throw leaguesErr;
    if (!leagues || leagues.length === 0) {
      return NextResponse.json({
        ok: true,
        advanced: 0,
        note: "No leagues found",
      });
    }

    const results: any[] = [];

    for (const lg of leagues as any[]) {
      const league_id = lg.id as string;
      const season_year = lg.season_year as number;
      const current_week = lg.current_week as number;

      if (current_week >= 18) {
        results.push({
          league_id,
          name: lg.name,
          advanced: false,
          reason: "Already week 18",
        });
        continue;
      }

      // Check whether current week games are all final
      const { data: games, error: gamesErr } = await supabaseAdmin
        .from("games")
        .select("status")
        .eq("season_year", season_year)
        .eq("week_number", current_week);

      if (gamesErr) throw gamesErr;

      const count = (games ?? []).length;
      const allFinal =
        count > 0 && (games ?? []).every((g: any) => g.status === "final");

      if (!allFinal) {
        results.push({
          league_id,
          name: lg.name,
          advanced: false,
          reason:
            count === 0
              ? "No games found for current week"
              : "Not all games final",
          season_year,
          current_week,
          games_found: count,
        });
        continue;
      }

      const next_week = current_week + 1;

      // Advance league week
      const { error: updErr } = await supabaseAdmin
        .from("leagues")
        .update({ current_week: next_week })
        .eq("id", league_id);

      if (updErr) throw updErr;

      // Immediately pull games for the new week so week config can derive lock_time
      const syncGamesRes = await postJson(baseUrl, "/api/sync-games", {
        season_year,
        week_number: next_week,
      });

      // Now create/update the weeks row (lock/reveal/picks_required) based on new week's games
      const syncWeekRes = await postJson(baseUrl, "/api/sync-week", {});

      results.push({
        league_id,
        name: lg.name,
        advanced: true,
        season_year,
        from_week: current_week,
        to_week: next_week,
        sync_games: syncGamesRes,
        sync_week: syncWeekRes,
      });
    }

    const advancedCount = results.filter((r) => r.advanced).length;

    return NextResponse.json({
      ok: true,
      advanced: advancedCount,
      results,
    });
  } catch (e: any) {
    console.error("advance-week error:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e) },
      { status: e?.message === "Unauthorized" ? 401 : 500 }
    );
  }
}
