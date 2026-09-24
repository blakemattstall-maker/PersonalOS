"use client";

import { useState } from "react";


export default function Collapsible({ children, collapsed = false, label = "content" }) {

  const [expanded, setExpanded] = useState(false);

  if (!collapsed) return children;

  return (
    <div>
      <div className={`relative ${expanded ? "" : "max-h-72 overflow-hidden"}`}>
        {children}
        {!expanded && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-[var(--card)]"
          />
        )}
      </div>
      <button
        type="button"
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
        className="mt-3 text-[0.78rem] font-medium text-ink underline decoration-[var(--line)] underline-offset-4"
      >
        {expanded ? `Show less ${label}` : `Show full ${label}`}
      </button>
    </div>
  );

}
