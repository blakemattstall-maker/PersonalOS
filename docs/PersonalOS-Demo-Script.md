# The 90-Second Demo — Shot List and Script

**Goal:** show, in 90 seconds, that this notices things about a life that no single screen could hold. Not architecture. Not a feature tour. One arc: *I speak → it files itself → it connects → it noticed something on its own.*

**Format:** phone screen recording, your voice over it, no slides. Open the private **showcase** at `/showcase` with the owner passphrase so every dashboard figure is fictional and safe to publish — the orange sample-data bar stays in frame. Record vertical.

**Shortcut rule:** do not point the real Almanac Shortcut at the showcase. The production Shortcut writes to the private owner account; the showcase is deliberately read-only and fixture-backed. Duplicate the Shortcut as **Almanac Showcase**, keep its opening capture actions for the shot, then replace its network request with a local **Show Result** reading `Captured for the showcase.` Cut from that confirmation to the pre-populated matching result on the showcase dashboard. Delete the duplicate after filming. This prevents a fake request from entering the real account and keeps the production Shortcut unchanged.

**Rule for the voiceover:** never say "pgvector", "Next.js", "the router", or "the graph database". Say what it *does*. A producer hiring you doesn't care how; they care that you shipped something that thinks.

---

## The shots

**0:00–0:10 — The press.** Home screen. Run **Almanac Showcase** and speak the sentence already represented by the sample data: *"Research comparable launches, compare them with my Coastal Rebrand work, build the client brief, draft the email, and remind me to follow up Friday."*
> VO: "I talk to it like a person."

**0:10–0:22 — It acted.** Cut to the pre-populated `Client review brief is ready` result on the showcase dashboard. Expand it to show the research, Doc, email draft and Friday task.
> VO: "One sentence became current research, a document, an email draft and a scheduled follow-up. I didn't fill in four forms."

**0:22–0:40 — The morning brief.** Open the dashboard. The brief is the first card. Scroll it slowly — the day's schedule, what's overdue, who's gone quiet.
> VO: "Every morning it writes me one of these. It's not a template — it's reading my actual calendar, my tasks, who I haven't talked to. And every number in it was computed in code, never guessed by the model."

**0:40–0:58 — The graph. This is the shot.** Tap the corner button → `/graph`. Let the force layout *settle* on camera — the nodes drifting into clusters is the moment. Then tap the 3D toggle and let the globe spin once.
> VO: "Everything it stores connects. This is my whole life as a map — people, projects, money, notes — built from what I captured, not tagged by hand. Tap a node and you walk to what it's attached to."
Tap one node (a person or a project); the card opens; tap a row to traverse.

**0:58–1:15 — It asks back.** Cut to a capture: *"What have I got going on with Costco?"* Show the spoken/returned answer naming the real connections — the task and the charges.
> VO: "And I can ask it about the connections out loud. It only tells me what's actually on file — if it doesn't know, it says so instead of making something up."

**1:15–1:30 — It noticed on its own.** End on an insight card / the daily digest — something the app raised without being asked ("you keep spending on X while saying you want Y", or a trend: "gym time down, eating-out up, three weeks running").
> VO: "The part I'm proudest of: once a day it decides *on its own* whether something's worth telling me — and most days it stays quiet. That restraint is the whole product."

**End card (static, 2s):** *PersonalOS — solo build · ~$7/month · try the demo: [link]* — no logo animation, no music sting.

---

## Notes

- **The settle is the sell.** Don't cut away from the graph while it's still moving. Give it the four seconds it needs to find its shape; that motion is the thing a screenshot can't do and every competitor's marketing can't fake.
- **Consider the time-lapse (Finish-Plan §10 D)** if built: a "play" control that adds edges in creation order so the net assembles itself. That's an even better 0:40 shot — the graph *growing* from lived data.
- **Keep your voice flat and specific.** The content is impressive; narrating it as impressive makes it sound less so. State facts, let them land.
- **One post when it's up.** Lead with the thesis, not the tech: *"I logged three months of my own life — location, spending, calendar — to find out whether a computer could actually notice things about it. Here's what it got right, and the feature I built and deleted."* Link the repo (PII-free by rule) and the demo.
