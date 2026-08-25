import supabase from "./supabase.js";
import { DateTime } from "luxon";
import { getUserTimezone } from "./profile.js";
import { getPendingNudges, getMostRecentBrief } from "../tools/database.js";
import { pendingInsights } from "../tools/islands.js";
import { getEvents } from "../tools/googleCalendar.js";
import { analyseDay } from "./eventKind.js";


// Everything the desk device is allowed to know, gathered once.
//
// Two surfaces read this: /api/desk returns it as JSON, and the same route
// with ?screen renders it as a picture. They must never drift — a device
// showing one thing while the API reports another is the kind of bug that
// costs an evening to even notice, so there is exactly one builder and both
// callers use it.
//
// Every source degrades alone, the same rule the brief follows: a dead Google
// token costs the countdown, not the whole screen, and it arrives as
// calendar:null ("unreachable") rather than as an empty day nobody actually
// looked at.
export async function buildDeskState() {

  const tz = await getUserTimezone();

  const now = DateTime.now().setZone(tz);

  const todayISO = now.toFormat("yyyy-MM-dd");

  const [nudges, prompts, insights, brief, calendar] = await Promise.all([

    getPendingNudges().catch(() => []),

    supabase
      .from("prompts")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .then(r => r.count || 0)
      .catch(() => 0),

    pendingInsights({ limit: 10 }).catch(() => []),

    getMostRecentBrief().catch(() => null),

    getEvents({ startDate: todayISO, endDate: todayISO, maxResults: 50 })
      .then(r => r.events || [])
      .catch(() => null)

  ]);


  const time = (iso) => DateTime.fromISO(iso).setZone(tz).toFormat("h:mma").toLowerCase();

  let calendarOut = null;

  if (calendar) {

    const day = analyseDay(calendar);

    const upcoming = calendar
      .filter(e => !e.allDay && e.start && DateTime.fromISO(e.start).setZone(tz) > now)
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    const next = upcoming[0] || null;

    const eveningStart = now.set({ hour: 18, minute: 0, second: 0, millisecond: 0 });

    calendarOut = {

      next: next ? {
        title: next.title,
        kind: next.kind,
        at: time(next.start),
        startsInMin: Math.max(0, Math.round(DateTime.fromISO(next.start).diff(now, "minutes").minutes))
      } : null,

      remaining: upcoming.length,

      lastEnd: day.lastEnd ? time(day.lastEnd) : null,

      eveningFree: !calendar.some(e =>
        !e.allDay && e.end && DateTime.fromISO(e.end).setZone(tz) > eveningStart
      ),

      // The day as a shape, for the timeline the screen draws: every timed
      // block as a fraction of the waking day. Computed here rather than on
      // the device for the same reason the brief's arithmetic is — a
      // microcontroller doing date maths is a bug waiting for a timezone.
      blocks: (day.stretches || []).map(s => ({
        startMin: DateTime.fromISO(s.start).setZone(tz).hour * 60 + DateTime.fromISO(s.start).setZone(tz).minute,
        endMin: DateTime.fromISO(s.end).setZone(tz).hour * 60 + DateTime.fromISO(s.end).setZone(tz).minute,
        kind: s.events[0]?.kind || "block",
        count: s.events.length
      }))

    };

  }


  // The ember rule, as a number. Anything the app raised that is still
  // waiting on him counts; zero means the screen rests moss.
  const attentionCount = nudges.length + prompts + insights.length;

  // The brief's opening sentence is written to be the one that matters —
  // same split briefPush uses for the phone notification.
  const lead = brief?.content ? (brief.content.split(/(?<=[.!?])\s/)[0] || null) : null;

  return {

    success: true,

    ts: now.toISO(),
    tz,

    // Pre-formatted for the screen so the renderer never does date maths.
    clock: {
      time: now.toFormat("h:mm"),
      meridiem: now.toFormat("a").toLowerCase(),
      date: now.toFormat("cccc d LLLL").toUpperCase(),
      nowMin: now.hour * 60 + now.minute
    },

    attention: {
      count: attentionCount,
      nudge: nudges[0] ? { id: nudges[0].id, message: nudges[0].message } : null
    },

    calendar: calendarOut,

    brief: brief ? { lead, unread: Boolean(brief.unread) } : null

  };

}
