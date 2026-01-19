import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabaseAdmin";

function mustBeCron(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const hasSecret =
    req.headers.get("x-cron-secret") === process.env.CRON_SECRET;
  if (!isVercelCron && !hasSecret) throw new Error("Unauthorized");
}

function getBaseUrl(req: Request) {
  if (process.env.APP_URL) return process.env.APP_URL;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
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

async function espnHasGames(
  season_year: number,
  week_number: number,
  season_type: number
) {
  const url = new URL(
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
  );
  url.searchParams.set("seasontype", String(season_type)); // 2=regular, 3=postseason
  url.searchParams.set("week", String(week_number));
  url.searchParams.set("dates", String(season_year));

  const r = await fetch(url.toString(), {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok)
    throw new Error(`ESPN fetch failed: ${r.status} ${await r.text()}`);

  const json: any = await r.json();
  const events: any[] = json.events ?? [];
  return events.length > 0;
}

export async function POST(req: Request) {
  try {
    mustBeCron(req);

    const baseUrl = getBaseUrl(req);
    const body = await req.json().catch(() => ({} as any));

    const league_id = String(body.league_id ?? "").trim();
    if (!league_id) {
      return NextResponse.json({ error: "Missing league_id" }, { status: 400 });
    }

    // Defaults for regular season, but you can pass season_type:3 for playoffs
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

    // Check whether current week games are all final (LEAGUE-SCOPED)
    const { data: games, error: gamesErr } = await supabaseAdmin
      .from("games")
      .select("status")
      .eq("league_id", league_id)
      .eq("season_year", lg.season_year)
      .eq("week_number", lg.current_week);

    if (gamesErr) throw gamesErr;

    const count = (games ?? []).length;
    const allFinal =
      count > 0 && (games ?? []).every((g: any) => g.status === "final");

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

    // SAFETY CHECK: verify next week exists at the provider before advancing
    const hasNextWeek = await espnHasGames(
      lg.season_year,
      next_week,
      season_type
    );
    if (!hasNextWeek) {
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

    // 1) Sync games for the new week (must succeed BEFORE advancing)
    const syncGamesRes = await postJson(baseUrl, "/api/sync-games", {
      league_id,
      season_type,
      season_year: lg.season_year,
      week_number: next_week,
    });

    // Require that sync-games actually found games
    if (!syncGamesRes?.ok || (syncGamesRes?.upserted ?? 0) === 0) {
      throw new Error(
        `sync-games returned no games for week ${next_week} (season_type=${season_type})`
      );
    }

    // 2) Sync week config for the new week (will 409 if no games)
    const syncWeekRes = await postJson(baseUrl, "/api/sync-week", {
      league_id,
      season_year: lg.season_year,
      week_number: next_week,
    });

    // 3) Only now advance league week
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
      sync_games: syncGamesRes,
      sync_week: syncWeekRes,
    });
  } catch (e: any) {
    console.error("advance-week error:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e) },
      { status: e?.message === "Unauthorized" ? 401 : 500 }
    );
  }
}
