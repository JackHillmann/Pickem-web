"use client";

import { useState } from "react";
import { teamLogoUrl } from "@/src/lib/teamLogo";

export function TeamLogo({
  abbr,
  size = 20,
  className = "",
}: {
  abbr: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gray-200 text-[9px] font-semibold text-gray-600 dark:bg-zinc-700 dark:text-zinc-300 ${className}`}
        style={{ width: size, height: size }}
      >
        {abbr.slice(0, 2)}
      </span>
    );
  }

  return (
    <img
      src={teamLogoUrl(abbr)}
      alt={abbr}
      width={size}
      height={size}
      loading="lazy"
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
