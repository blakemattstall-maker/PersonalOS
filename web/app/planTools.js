// The plan-builder toggles, for the dashboard.
//
// This deliberately duplicates the labels in lib/planTools.js on the backend.
// The two are separate Vercel projects with separate roots, so `web/` cannot
// import from the repo root — and reaching across would break the build rather
// than fail gracefully.
//
// The duplication is safe because the backend is authoritative: it runs every
// incoming toggle set through normalisePlanTools(), which fills in anything
// missing with that tool's real default. So if a capability is added on the
// backend and not here, it simply behaves as designed rather than being
// silently switched off — the worst case is that the checkbox is missing from
// the UI until this file catches up.
//
// /api/deepThoughts also returns the canonical list as `planTools`, if this
// ever needs to be driven from the server instead.

export const PLAN_TOOLS = {

  research: {
    label: "Web research",
    hint: "Look up real prices, vendors, requirements — with cited sources",
    default: true
  },

  tasks: {
    label: "Google Tasks",
    hint: "Create the sequenced task list",
    default: true
  },

  events: {
    label: "Calendar events",
    hint: "Add anything tied to a specific time",
    default: true
  },

  docs: {
    label: "Google Docs",
    hint: "Export the written materials as real documents",
    default: false
  },

  gmail: {
    label: "Gmail drafts",
    hint: "Draft any emails the plan calls for — never sends them",
    default: false
  }

};
