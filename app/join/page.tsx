"use client";

import { useState } from "react";
import { supabase } from "@/src/lib/supabaseClient";
import { useRequireAuth } from "@/src/lib/useRequireAuth";
import { useRouter } from "next/navigation";
import { LoadingSpinner } from "@/src/components/LoadingSpinner";

export default function JoinPage() {
  const router = useRouter();
  const { loading } = useRequireAuth();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <LoadingSpinner />;

  async function onJoin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!name.trim()) {
      setErr("Enter a display name so other players know who you are.");
      return;
    }

    setBusy(true);

    const { data, error } = await supabase.rpc("join_league", {
      p_invite_code: code.trim().toUpperCase(),
    });

    if (error) {
      setBusy(false);
      return setErr(error.message);
    }

    const { data: session } = await supabase.auth.getSession();
    if (session?.session?.user) {
      await supabase
        .from("league_members")
        .update({ display_name: name.trim() })
        .eq("user_id", session.session.user.id);
    }

    setBusy(false);

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

        <div>
          <label className="mb-1 block text-sm font-medium">Your name</label>
          <input
            className="w-full rounded border p-3"
            placeholder="Ex: Curly Lambeau"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <p className="mt-1 text-xs text-gray-600">
            This is what other players will see.
          </p>
        </div>

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
