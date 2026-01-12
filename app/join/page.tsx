"use client";

import { useState } from "react";
import { supabase } from "@/src/lib/supabaseClient";
import { useRequireAuth } from "@/src/lib/useRequireAuth";
import { useRouter } from "next/navigation";

export default function JoinPage() {
  const router = useRouter();
  const { loading } = useRequireAuth();
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return null;

  async function onJoin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);

    const { data, error } = await supabase.rpc("join_league", { p_invite_code: code.trim() });

    setBusy(false);
    if (error) return setErr(error.message);

    // data is league_id
    router.push("/picks");
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-semibold">Join league</h1>
      <p className="mt-2 text-sm text-gray-600">
        Enter the invite code you got from the commissioner.
      </p>

      <form onSubmit={onJoin} className="mt-6 space-y-4">
        <input
          className="w-full rounded border p-3 uppercase tracking-wider"
          placeholder="INVITE CODE"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />

        {err && <p className="text-sm text-red-600">{err}</p>}

        <button
          className="w-full rounded bg-black p-3 text-white disabled:opacity-50"
          disabled={busy}
        >
          {busy ? "Joining..." : "Join"}
        </button>
      </form>
    </main>
  );
}
