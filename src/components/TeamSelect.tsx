"use client";

import { useEffect, useRef, useState } from "react";
import { TeamLogo } from "./TeamLogo";

export function TeamSelect({
  value,
  options,
  onChange,
  disabled,
  placeholder,
}: {
  value: string;
  options: string[];
  onChange: (abbr: string) => void;
  disabled?: boolean;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, options.indexOf(value));
    setHighlighted(idx);
  }, [open, value, options]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[highlighted]?.scrollIntoView({ block: "nearest" });
  }, [open, highlighted]);

  function selectAt(idx: number) {
    const abbr = options[idx];
    if (!abbr) return;
    onChange(abbr);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;

    if (!open) {
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Enter" ||
        e.key === " "
      ) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlighted((h) => Math.min(options.length - 1, h + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlighted((h) => Math.max(0, h - 1));
        break;
      case "Home":
        e.preventDefault();
        setHighlighted(0);
        break;
      case "End":
        e.preventDefault();
        setHighlighted(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        selectAt(highlighted);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
        className="flex w-full items-center gap-2 rounded border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
      >
        {value ? (
          <>
            <TeamLogo abbr={value} />
            <span>{value}</span>
          </>
        ) : (
          <span className="text-gray-500">{placeholder}</span>
        )}
        <span className="ml-auto text-gray-400">▾</span>
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded border bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {options.length === 0 && (
            <li className="p-3 text-sm text-gray-500">No teams available</li>
          )}
          {options.map((abbr, idx) => (
            <li
              key={abbr}
              ref={(el) => {
                optionRefs.current[idx] = el;
              }}
              role="option"
              aria-selected={abbr === value}
              onMouseEnter={() => setHighlighted(idx)}
              onClick={() => selectAt(idx)}
              className={`flex cursor-pointer items-center gap-2 p-3 text-sm ${
                idx === highlighted
                  ? "bg-emerald-50 dark:bg-emerald-950"
                  : ""
              } ${abbr === value ? "font-semibold" : ""}`}
            >
              <TeamLogo abbr={abbr} />
              <span>{abbr}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
