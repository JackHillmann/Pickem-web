@AGENTS.md

# Pick'em League

NFL confidence-style pick'em pool for a private friend group. Each week players pick 2 teams they think will win (1 team in weeks 17-18); a team can't be reused once picked in a season; each player gets 1 bye per season. Next.js 16 (App Router, Turbopack) + Supabase (Postgres + Auth) + Vercel, Tailwind v4, TypeScript.

Live at https://www.pickempool.club (and bare `pickempool.club`). Repo: https://github.com/JackHillmann/Pickem-web.

## Current status (as of 2026-08-13)

**Preseason testing, not yet live for the real 2026 season.** The app was built in Jan 2026, sat completely dormant for ~7 months (Supabase project got auto-deleted from inactivity, GitHub Actions scheduler got auto-disabled), and was fully resurrected in August 2026 ahead of the season. Real Week 1 (regular season, Sept 10 2026 kickoff) is already fully configured and untouched — going live is a single deliberate flip of `leagues.current_season_type` from `1` (preseason) to `2` (regular), plus `current_week` back to `1`. Don't do this without being asked.

## The core architectural pattern: `season_type`

`leagues.current_season_type` (1=preseason, 2=regular, 3=postseason) plus `leagues.current_week` together define "what's currently active" for the whole league. Every table that stores per-week data — `games`, `weeks`, `picks`, `byes`, `pick_results` — carries a `season_type` column, so preseason and regular-season rows can share the same `week_number` values without colliding.

**Every query against these tables should filter by `season_type`.** Two different scoping choices are both intentional, not inconsistent:
- Most reads (current week's games, week config, a user's own picks) filter by `league.current_season_type` — "whatever's currently active."
- A few things need to explicitly force `season_type: 2` or otherwise ignore `current_season_type` — none currently do this on purpose after the Aug 2026 rework (used-teams/bye/standings were deliberately switched *from* hardcoded-to-regular *to* dynamic, per the product decision that preseason testing should fully behave like a real season, isolated from but structurally identical to it).

When adding a new feature that touches per-week data, thread `season_type` through it the same way — see `app/api/sync-games/route.ts`, `app/api/grade-week/route.ts`, and `app/picks/page.tsx` for the established pattern.

## Key files

- `app/picks/page.tsx` — the main picks UI; also owns the used-teams/bye eligibility logic
- `app/matchups/page.tsx` — browsable schedule for any season_type/week combo, independent of what's "current"
- `app/api/sync-games/route.ts` — pulls a week's schedule/scores from ESPN's unofficial public API, upserts into `games`
- `app/api/grade-week/route.ts` — grades all picks for the current week against final games
- `app/api/advance-week/route.ts` — auto-advances `current_week` once all current-week games are final (regular season only in practice, since the cron hardcodes `season_type: 2` here)
- `app/api/send-reminders/route.ts` — emails (via Resend) anyone who hasn't submitted picks, once, ~1hr before lock
- `src/components/TeamSelect.tsx` — hand-rolled combobox for team pickers; native `<select><option>` can't render logos, hence a custom component
- `.github/workflows/cron.yml` — the whole scheduling story (every 5 min: sync-games/grade-week/send-reminders; hourly: advance-week; daily: sync-week config)

## Known gotchas

- **ESPN's scoreboard API** will 403 (Akamai bot-block) on rapid sequential requests — space out bulk/backfill calls by a few seconds.
- **GitHub Actions free-tier cron is imprecise** — "best effort," can drift 8-40 min off the nominal 5-min schedule. Not a bug.
- **Supabase's default email sender has a very low rate limit** — a few real signups close together can trigger "email rate limit exceeded." Fix: disable "Confirm email" in Supabase Auth settings, or route through Resend's SMTP (already verified for this domain).
- **GoDaddy's free "Website Builder" product can silently intercept a domain** even after DNS correctly points to Vercel — check the domain's "Products" tab (not DNS, not Forwarding) if a custom domain seems stuck serving a GoDaddy page.

## Env vars

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, `REMINDER_FROM_EMAIL` (optional), `SITE_URL` (optional). GitHub Actions secrets: `APP_URL`, `CRON_SECRET`, `LEAGUE_ID`.
