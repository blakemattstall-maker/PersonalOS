// Which capabilities the plan builder is allowed to use for a given thread.
//
// Building a plan can reach into five different places, and the right set is
// not the same every time — a plan for "how do I handle this conversation with
// my co-founder" wants research and nothing else, while "launch the next VATHOS
// drop" wants the whole toolbox. Before this, every build did everything, so
// the only way to avoid a pile of Google tasks was to not build the plan.
//
// Defaults are the previous behaviour exactly: research, tasks and calendar on;
// the two that produce outward-facing artefacts off. A Gmail draft or a Google
// Doc appearing unasked is a different category of surprise from a task
// appearing — one is a to-do list getting longer, the other is something that
// looks ready to send.

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


export const PLAN_TOOL_KEYS = Object.keys(PLAN_TOOLS);


export function defaultPlanTools() {

  return Object.fromEntries(
    PLAN_TOOL_KEYS.map(key => [key, PLAN_TOOLS[key].default])
  );

}


// Anything absent falls back to its default rather than to false: a caller that
// knows nothing about a newly added tool should get that tool's intended
// behaviour, not silently switch it off.
export function normalisePlanTools(tools) {

  const base = defaultPlanTools();

  if (!tools || typeof tools !== "object") return base;

  for (const key of PLAN_TOOL_KEYS) {
    if (typeof tools[key] === "boolean") base[key] = tools[key];
  }

  return base;

}


export function describeEnabledTools(tools) {

  const on = PLAN_TOOL_KEYS.filter(k => tools[k]);

  if (on.length === 0) return "nothing — this will only write the plan itself";

  return on.map(k => PLAN_TOOLS[k].label).join(", ");

}
