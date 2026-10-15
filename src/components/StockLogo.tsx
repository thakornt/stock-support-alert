"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A company logo from our own database (/api/logo), or the first letter of the ticker when there is none
 * (or the image fails to load). Logos sit on a light tile because many are dark or transparent and would
 * vanish on the dark theme. Fixed size, so nothing shifts while images load; until the image has arrived a pulsing
 * placeholder with the letter is shown instead of an empty white tile.
 */
export function StockLogo({ symbol, version, className = "size-9" }: { symbol: string; version: number | null; className?: string }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  const img = useRef<HTMLImageElement>(null);

  // already in the browser cache: it may have finished before React attached onLoad
  useEffect(() => {
    const el = img.current;
    if (el?.complete) setState(el.naturalWidth > 0 ? "loaded" : "failed");
  }, []);

  const letter = (
    <span aria-hidden="true" className="font-mono text-sm font-semibold text-muted">
      {symbol.charAt(0)}
    </span>
  );

  if (version === null || state === "failed") {
    return <span className={`grid shrink-0 place-items-center rounded-lg bg-elevated ring-1 ring-border ${className}`}>{letter}</span>;
  }
  const loaded = state === "loaded";
  return (
    <span className={`relative grid shrink-0 place-items-center overflow-hidden rounded-lg ring-1 ring-border ${loaded ? "bg-white" : "animate-pulse bg-elevated"} ${className}`}>
      {!loaded && letter}
      {/* eslint-disable-next-line @next/next/no-img-element -- served by our own route, already small */}
      <img
        ref={img}
        src={`/api/logo/${encodeURIComponent(symbol)}?v=${Math.round(version)}`}
        alt=""
        width={36}
        height={36}
        loading="lazy"
        onLoad={() => setState("loaded")}
        onError={() => setState("failed")}
        className={`absolute inset-0 size-full object-contain p-1 transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </span>
  );
}
