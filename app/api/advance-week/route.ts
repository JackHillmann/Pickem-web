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

/**
 * Like your old postJson, but DOES NOT throw.
 * Returns status + parsed json (if any) so advance-week can decide
 * whether this is "retry later" (200) vs "unexpected" (500).
 */
async function postJsonSafe(baseUrl: string, path: string, body: any) {
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
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    ok: r.ok,
    status: r.status,
    json,
    text,
  };
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
): Promise<
  { ok: true; hasGames: boolean } | { ok: false; status: number; error: string }
> {
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

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return { ok: false, status: r.status, error: t || "ESPN error" };
  }

  const json: any = await r.json().catch(() => ({}));
  const events: any[] = json.events ?? [];
  return { ok: true, hasGames: events.length > 0 };
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

    // Provider existence check
    const provider = await espnHasGames(lg.season_year, next_week, season_type);
    if (!provider.ok) {
      // retry-later, not a server crash
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

    if (!provider.hasGames) {
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
    const syncGames = await postJsonSafe(baseUrl, "/api/sync-games", {
      league_id,
      season_type,
      season_year: lg.season_year,
      week_number: next_week,
    });

    if (!syncGames.ok) {
      // retry-later
      return NextResponse.json({
        ok: true,
        league_id,
        advanced: false,
        reason: "sync-games failed; will retry later",
        season_year: lg.season_year,
        from_week: lg.current_week,
        to_week: next_week,
        sync_games_status: syncGames.status,
        sync_games_body: syncGames.json ?? syncGames.text,
      });
    }

    const upserted = Number(syncGames.json?.upserted ?? 0);
    if (upserted <= 0) {
      // retry-later
      return NextResponse.json({
        ok: true,
        league_id,
        advanced: false,
        reason: "sync-games returned 0 games; will retry later",
        season_year: lg.season_year,
        from_week: lg.current_week,
        to_week: next_week,
        sync_games: syncGames.json ?? syncGames.text,
      });
    }

    // 2) Sync week config for the new week
    const syncWeek = await postJsonSafe(baseUrl, "/api/sync-week", {
      league_id,
      season_year: lg.season_year,
      week_number: next_week,
    });

    if (!syncWeek.ok) {
      // retry-later (often 409 if games aren't visible yet)
      return NextResponse.json({
        ok: true,
        league_id,
        advanced: false,
        reason: "sync-week failed; will retry later",
        season_year: lg.season_year,
        from_week: lg.current_week,
        to_week: next_week,
        sync_week_status: syncWeek.status,
        sync_week_body: syncWeek.json ?? syncWeek.text,
      });
    }

    // 3) Only now advance league week (this prevents broken state)
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
      sync_games: syncGames.json ?? syncGames.text,
      sync_week: syncWeek.json ?? syncWeek.text,
    });
  } catch (e: any) {
    console.error("advance-week error:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e) },
      { status: e?.message === "Unauthorized" ? 401 : 500 }
    );
  }
}
