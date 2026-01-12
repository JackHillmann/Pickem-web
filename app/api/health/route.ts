import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabaseAdmin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("leagues")
    .select("id,name")
    .limit(1);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, league: data?.[0] ?? null });
}
