import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = {
  season_year: number;     // e.g. 2026
  week_number: number;     // 1..18
  season_type?: number;    // 2 regular season
  provider?: string;       // default "espn"
};

serve(async (req) => {
  try {
    const {
      season_year,
      week_number,
      season_type = 2,
      provider = "espn",
    } = (await req.json()) as Body;

    if (!season_year || !week_number) {
      return new Response(JSON.stringify({ ok: false, error: "season_year and week_number required" }), { status: 400 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // ESPN weekly scoreboard
    const url = new URL("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard");
    url.searchParams.set("seasontype", String(season_type));
    url.searchParams.set("week", String(week_number));
    // "dates" is commonly used; passing the season year here works in many cases
    url.searchParams.set("dates", String(season_year));

    const r = await fetch(url.toString(), { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`ESPN fetch failed: ${r.status} ${await r.text()}`);

    const json = await r.json();
    const events = (json.events ?? []) as any[];

    const rows: any[] = [];

    for (const ev of events) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;

      const kickoff_time = comp.date; // ISO

      const competitors = comp.competitors ?? [];
      const home = competitors.find((c: any) => c.homeAway === "home");
      const away = competitors.find((c: any) => c.homeAway === "away");
      if (!home?.team?.abbreviation || !away?.team?.abbreviation) continue;

      const home_abbr = home.team.abbreviation;
      const away_abbr = away.team.abbreviation;

      const statusType = comp.status?.type;
      const state = statusType?.state;       // "pre" | "in" | "post"
      const completed = !!statusType?.completed;

      const status =
        state === "in" ? "inprogress" :
        state === "post" ? "final" :
        "scheduled";

      const home_score = home.score != null ? Number(home.score) : null;
      const away_score = away.score != null ? Number(away.score) : null;

      let winner_abbr: string | null = null;
      if (completed && home_score != null && away_score != null) {
        if (home_score > away_score) winner_abbr = home_abbr;
        else if (away_score > home_score) winner_abbr = away_abbr;
        else winner_abbr = null; // tie
      }

      rows.push({
        league_id: null, // global table usage
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

    if (!rows.length) {
      return new Response(JSON.stringify({ ok: true, season_year, week_number, upserted: 0 }), {
        headers: { "content-type": "application/json" },
      });
    }

    const { error } = await sb
      .from("games")
      .upsert(rows, { onConflict: "season_year,game_id" });

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, season_year, week_number, upserted: rows.length }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
