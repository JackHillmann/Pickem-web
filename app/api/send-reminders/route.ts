import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabaseAdmin";

function mustBeCron(req: Request) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const hasSecret =
    req.headers.get("x-cron-secret") === process.env.CRON_SECRET;
  if (!isVercelCron && !hasSecret) throw new Error("Unauthorized");
}

// Single reminder tier: fires once, the first time a cron run observes
// less than an hour remaining until lock, for anyone who still hasn't
// submitted. The reminder_log unique constraint guarantees it never
// fires twice for the same person/week even though cron checks every
// 5 minutes.
const TIERS: { tier: string; hours: number }[] = [{ tier: "1h", hours: 1 }];

async function getLeagueContextById(league_id: string) {
  const { data, error } = await supabaseAdmin
    .from("leagues")
    .select("id,name,season_year,current_week,current_season_type")
    .eq("id", league_id)
    .single();

  if (error) throw error;
  if (!data) throw new Error("League not found");

  return data as {
    id: string;
    name: string;
    season_year: number;
    current_week: number;
    current_season_type: number;
  };
}

async function sendReminderEmail(to: string, name: string, appUrl: string) {
  const from =
    process.env.REMINDER_FROM_EMAIL ?? "Pick'em League <reminders@pickempool.club>";

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: "Your picks aren't in yet!",
      html: `<p>Hey ${name || "there"},</p>
<p>Picks lock soon and you haven't submitted yours yet. Get them in before the lock:</p>
<p><a href="${appUrl}/picks">${appUrl}/picks</a></p>
<p>&mdash; Pick'em League</p>`,
    }),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Resend error: ${r.status} ${t}`);
  }
}

export async function POST(req: Request) {
  try {
    mustBeCron(req);

    const body = await req.json().catch(() => ({} as any));
    const league_id = String(body.league_id ?? "").trim();
    if (!league_id) {
      return NextResponse.json({ error: "Missing league_id" }, { status: 400 });
    }

    const appUrl = String(body.app_url ?? process.env.SITE_URL ?? "https://www.pickempool.club");

    const lg = await getLeagueContextById(league_id);
    const season_year = lg.season_year;
    const season_type = lg.current_season_type;
    const week_number = lg.current_week;

    // 1) Week config: need lock_time + picks_required
    const { data: weekRows, error: weekErr } = await supabaseAdmin
      .from("weeks")
      .select("lock_time,picks_required")
      .eq("league_id", league_id)
      .eq("season_year", season_year)
      .eq("season_type", season_type)
      .eq("week_number", week_number)
      .limit(1);

    if (weekErr) throw weekErr;
    if (!weekRows?.length) {
      return NextResponse.json({
        ok: true,
        reason: "No week config yet; nothing to remind about",
      });
    }

    const lockTime = new Date(weekRows[0].lock_time).getTime();
    const picksRequired = weekRows[0].picks_required as number;
    const now = Date.now();
    const hoursRemaining = (lockTime - now) / (1000 * 60 * 60);

    if (hoursRemaining <= 0) {
      return NextResponse.json({
        ok: true,
        reason: "Already locked; nothing to remind about",
      });
    }

    // Which tiers have been crossed (time remaining at or below the tier threshold)
    const crossedTiers = TIERS.filter((t) => hoursRemaining <= t.hours);
    if (crossedTiers.length === 0) {
      return NextResponse.json({
        ok: true,
        reason: "No tier crossed yet",
        hoursRemaining,
      });
    }

    // 2) League roster
    const { data: members, error: membersErr } = await supabaseAdmin
      .from("league_members")
      .select("user_id,display_name")
      .eq("league_id", league_id);

    if (membersErr) throw membersErr;
    if (!members?.length) {
      return NextResponse.json({ ok: true, reason: "No members" });
    }

    // 3) Who's already submitted (bye or full picks) for this week
    const { data: pickRows, error: pickErr } = await supabaseAdmin
      .from("picks")
      .select("user_id")
      .eq("league_id", league_id)
      .eq("season_year", season_year)
      .eq("season_type", season_type)
      .eq("week_number", week_number);
    if (pickErr) throw pickErr;

    const { data: byeRows, error: byeErr } = await supabaseAdmin
      .from("byes")
      .select("user_id")
      .eq("league_id", league_id)
      .eq("season_year", season_year)
      .eq("season_type", season_type)
      .eq("week_number", week_number);
    if (byeErr) throw byeErr;

    const pickCountByUser = new Map<string, number>();
    (pickRows ?? []).forEach((r: any) => {
      pickCountByUser.set(r.user_id, (pickCountByUser.get(r.user_id) ?? 0) + 1);
    });
    const byeUsers = new Set((byeRows ?? []).map((r: any) => r.user_id));

    const pendingMembers = members.filter((m: any) => {
      if (byeUsers.has(m.user_id)) return false;
      return (pickCountByUser.get(m.user_id) ?? 0) < picksRequired;
    });

    if (pendingMembers.length === 0) {
      return NextResponse.json({ ok: true, reason: "Everyone has submitted" });
    }

    // 4) Already-sent reminders for the tiers we're considering
    const { data: alreadySent, error: sentErr } = await supabaseAdmin
      .from("reminder_log")
      .select("user_id,tier")
      .eq("league_id", league_id)
      .eq("season_year", season_year)
      .eq("season_type", season_type)
      .eq("week_number", week_number)
      .in(
        "tier",
        crossedTiers.map((t) => t.tier)
      );
    if (sentErr) throw sentErr;

    const sentSet = new Set(
      (alreadySent ?? []).map((r: any) => `${r.user_id}:${r.tier}`)
    );

    let sent = 0;
    const failures: string[] = [];

    for (const member of pendingMembers) {
      for (const t of crossedTiers) {
        const key = `${member.user_id}:${t.tier}`;
        if (sentSet.has(key)) continue;

        try {
          const { data: userData, error: userErr } =
            await supabaseAdmin.auth.admin.getUserById(member.user_id);
          if (userErr || !userData?.user?.email) {
            failures.push(`${member.user_id}: no email found`);
            continue;
          }

          await sendReminderEmail(
            userData.user.email,
            member.display_name ?? "",
            appUrl
          );

          // Insert-based dedup: unique constraint means a duplicate send
          // (e.g. two overlapping cron runs) fails harmlessly here instead
          // of emailing twice.
          const { error: logErr } = await supabaseAdmin.from("reminder_log").insert({
            league_id,
            season_year,
            season_type,
            week_number,
            user_id: member.user_id,
            tier: t.tier,
          });
          if (logErr && !logErr.message.toLowerCase().includes("duplicate")) {
            throw logErr;
          }

          sent += 1;
        } catch (e: any) {
          failures.push(`${member.user_id} (${t.tier}): ${e?.message ?? e}`);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      league_id,
      week_number,
      hoursRemaining,
      crossedTiers: crossedTiers.map((t) => t.tier),
      pendingMembers: pendingMembers.length,
      sent,
      failures,
    });
  } catch (e: any) {
    console.error("send-reminders error:", e);
    return NextResponse.json(
      { error: e?.message ?? String(e) },
      { status: e?.message === "Unauthorized" ? 401 : 500 }
    );
  }
}
