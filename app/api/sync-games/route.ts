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
    .select("season_year,current_week")
    .limit(1)
    .single();

  if (error) throw error;
  if (!data) throw new Error("League not found");

  return {
    season_year: data.season_year,
    week_number: data.current_week,
  };
}

function mapStatus(state: string | undefined): "scheduled" | "inprogress" | "final" {
  if (state === "in") return "inprogress";
  if (state === "post") return "final";
  return "scheduled";
}

export async function POST(req: Request) {
  try {
    mustBeCron(req);

    const body = await req.json().catch(() => ({}));
    const ctx = await getLeagueContext();

    const season_year = Number(body.season_year ?? ctx.season_year);
    const week_number = Number(body.week_number ?? ctx.week_number);
    const season_type = Number(body.season_type ?? 2);
    const provider = String(body.provider ?? "espn");

    const url = new URL("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard");
    url.searchParams.set("seasontype", String(season_type));
    url.searchParams.set("week", String(week_number));
    // ESPN accepts this commonly; if it ever returns empty, we can adjust to "season" param.
    url.searchParams.set("dates", String(season_year));

    const r = await fetch(url.toString(), { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`ESPN fetch failed: ${r.status} ${await r.text()}`);

    const json: any = await r.json();
    const events: any[] = json.events ?? [];

    const rows: any[] = [];

    for (const ev of events) {
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
        else winner_abbr = null; // tie
      }

      rows.push({
        league_id: null, // global table usage; requires league_id nullable
        season_year,
        week_number,
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
      return NextResponse.json({ ok: true, season_year, week_number, upserted: 0, note: "No events returned" });
    }

    const { error: upErr } = await supabaseAdmin
      .from("games")
      .upsert(rows, { onConflict: "season_year,game_id" });

    if (upErr) throw upErr;

    return NextResponse.json({
      ok: true,
      season_year,
      week_number,
      upserted: rows.length,
    });
  } catch (e: any) {
    console.error("sync-games error:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e) },
      { status: e?.message === "Unauthorized" ? 401 : 500 }
    );
  }
}
