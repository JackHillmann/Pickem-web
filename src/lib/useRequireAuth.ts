"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/src/lib/supabaseClient";

const DEFAULT_BYPASS_PATHS = ["/login", "/join", "/auth/callback"] as const;

type RequireAuthOptions = {
  /**
   * If true, user must have a row in league_members (default true)
   */
  requireMembership?: boolean;

  /**
   * Routes that should NOT enforce membership (avoid redirect loops)
   */
  membershipBypassPaths?: readonly string[];
};

export function useRequireAuth(options: RequireAuthOptions = {}) {
  const router = useRouter();
  const pathname = usePathname();

  const requireMembership = options.requireMembership ?? true;
  const membershipBypassPaths =
    options.membershipBypassPaths ?? DEFAULT_BYPASS_PATHS;

  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);

      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;

      const user = data.session?.user;

      if (error || !user) {
        setUserId(null);
        setLoading(false);
        router.replace("/login");
        return;
      }

      const uid = user.id;
      setUserId(uid);

      // Bypass membership check on certain pages to avoid loops
      const bypass = membershipBypassPaths.some(
        (p) => pathname === p || (pathname?.startsWith(p + "/") ?? false)
      );

      if (requireMembership && !bypass) {
        const { data: memberRow, error: memberErr } = await supabase
          .from("league_members")
          .select("league_id")
          .eq("user_id", uid)
          .limit(1)
          .maybeSingle();

        if (cancelled) return;

        if (memberErr) {
          console.error("league_members check failed:", memberErr);
          router.replace("/join");
          setLoading(false);
          return;
        }

        if (!memberRow) {
          router.replace("/join");
          setLoading(false);
          return;
        }
      }

      setLoading(false);
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [router, pathname, requireMembership, membershipBypassPaths]);

  return { userId, loading };
}
