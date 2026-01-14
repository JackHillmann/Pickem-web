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
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);

    // Where Supabase should send the user after they click the confirmation link
    const emailRedirectTo = `${window.location.origin}/join`;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo },
    });

    setBusy(false);

    if (error) return setErr(error.message);

    // If email confirmations are ON, they won't be logged in yet.
    // Show a message telling them to check email.
    if (!data.session) {
      setMsg(
        "Check your email to confirm your account. You'll be sent to Join after confirming."
      );
      return;
    }

    // If email confirmations are OFF, they’ll be logged in immediately.
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
        {msg && <p className="text-sm text-green-700">{msg}</p>}

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
