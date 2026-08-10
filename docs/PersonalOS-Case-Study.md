# PersonalOS — A Case Study in Building One Thing Well

*A solo-built personal operating system: it reads and writes my real calendar, tasks, email, banking and location, and once a day it decides on its own whether anything is worth telling me. Single-user by design, running on free tiers at about $7/month.*

This is not a feature list. It's four decisions, and what each one cost. I'm a marketing major who taught myself to build this, and the thing I want it to demonstrate isn't that I can wire up an API — it's that I know what *not* to build, and that I can find the ways my own work is quietly wrong.

---

## Decision 1 — One notification a day, and most days none

The easy version of this app interrupts you constantly. Every app does; attention is the only thing they're really competing for. I built several features that pushed notifications and then deleted the pushing, because twenty notifications a week "takes the magic out of it" — the moment the app is muted, every other feature dies with it.

So the interruption budget became an *architectural constraint*, not a setting. There's a dial with four positions, every push must be classified against it, and a push whose urgency isn't classified is undeliverable by construction — it fails a test at build time rather than quietly failing on a phone. The default is one digest a day plus genuinely urgent exceptions, and the observer that decides whether to speak is instructed that **silence is the correct answer on most days.**

**What it cost:** real features I'd built and liked. **What it bought:** an app I actually leave notifications on for — which is the only state in which any of the rest of it matters.

---

## Decision 2 — The machine never does the arithmetic

Large language models narrate; they don't tally. Ask one to add up your spending and it will produce a confident, specific, wrong number. So the rule across the whole system is: **compute every figure in code, hand the model the number as a fact, and forbid it from recomputing.**

This sounds obvious and is constantly violated. I violated it three times without noticing, in three different files, each with its own copy of "total up the spending" — and they disagreed by a factor of three, because one of them had never heard of the "transfers" category and was counting money moved between my own accounts as spending. The fix wasn't to correct the number. It was to delete every place the number could be computed except one: a single function that is now the only source of a money figure anywhere, enforced by a test that fails if anything reaches around it.

**The generalized lesson:** a disagreement between two numbers is never fixed by fixing a number. It's fixed by removing the second place the number can come from.

---

## Decision 3 — I built the auto-trading feature, then deleted it

I wanted an accountability mechanic: real money moved automatically based on whether I did what I said I'd would. I built it — real prices, deterministic triggers, a generated fund manager with a personality. Then I deleted the whole thing.

Two reasons, and the order matters. First, a paper version (fake money) wasn't worth having — the stakes were the point. Second, and non-negotiable: **an automated system placing real financial trades off the back of "did he go to the gym" is a bad idea at any dollar amount.** That's not a design call I get to make differently on a Tuesday; it's a line. The read-only version — showing my real positions, never touching them — stays fair game. Executing trades does not.

**What it demonstrates:** knowing when the right amount of a feature is zero, and holding a safety line against my own enthusiasm for the build.

---

## Decision 4 — I audit my own system against production, and it lies to me

Twice now I've run an adversarial pass over my own code — reading it, then checking every claim against the live database and by probing the running app, because *the code and the docs both lie in the same direction.*

The first audit found three defects that had never once surfaced to me as a user: a whole section of my daily brief that had never appeared because of a one-word typo (`title` where the column is `name`), swallowed silently on every run since it was written; the 3× money error above; and a health check that reported "all systems green" while never looking at two of the ten things it was supposed to check.

The second audit — the one that produced this document — found worse: **the passphrase gate on my dashboard had never protected a single write.** The framework I used forwards a certain kind of request around the gate entirely, and because my server-side calls inject the master credential automatically, anyone on the internet could have deleted my data or spent my API budget by copying an identifier out of the public demo. I confirmed it against the live site, fixed it at the one place all writes funnel through, and wrote the test that fails if that lock ever comes off.

**The pattern in every one of these:** none produced an error, a failed test, or a wrong-looking screen. A function that returns the same empty value for "nothing to report" and "the query is broken" will eventually be broken and silent, and *silent* is the word that matters. The engineering maturity I'm claiming isn't that I write code without bugs. It's that I know what a silent failure looks like, I go looking for them on purpose, and I make the next one loud.

---

## What it actually is, underneath

For the technically curious: a router (an LLM choosing among ~24 tools) sits behind a voice capture from an iPhone; the tools read and write Google Calendar/Tasks/Gmail/Docs, a bank feed, and GPS. Everything it stores becomes an entity graph you can literally walk — a fullscreen force-directed view of your whole life, with an optional spinning 3D globe. A daily observer looks across every domain and decides whether to speak. About 240 automated tests, one deployment, ~$7/month.

But if you take one thing from this, take the four decisions — because the code is replaceable and the judgment isn't.

---

*Built solo, 2026. The repository is public and contains no real personal data by rule. A read-only demo runs on fictional data — passphrase `demo`.*
