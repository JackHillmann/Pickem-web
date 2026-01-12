"use client";

import { useState } from "react";
import { supabase } from "@/src/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);

    const { error } = await supabase.auth.signUp({ email, password });
    setBusy(false);

    if (error) return setErr(error.message);

    // If email confirmations are off, they’ll be logged in.
    router.push("/join");
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-semibold">Create account</h1>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <input
          className="w-full rounded border p-3"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="w-full rounded border p-3"
          placeholder="Password (min 6)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />

        {err && <p className="text-sm text-red-600">{err}</p>}

        <button
          className="w-full rounded bg-black p-3 text-white disabled:opacity-50"
          disabled={busy}
        >
          {busy ? "Creating..." : "Create account"}
        </button>

        <button
          type="button"
          className="w-full rounded border p-3"
          onClick={() => router.push("/login")}
        >
          Back to login
        </button>
      </form>
    </main>
  );
}
