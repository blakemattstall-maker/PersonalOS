import Link from "next/link";
import { DateTime } from "luxon";
import { backendGet } from "../backend.js";
import DiningMenu from "../DiningMenu.js";
import DiningSyncButton from "../DiningSyncButton.js";
import Reveal from "../Reveal.js";
import { Page, PageHeader, Empty, Meta } from "../ui.js";


export const dynamic = "force-dynamic";
// The Sync button's server action runs under this segment's config, and a
// sync slice works a 35s budget — the default duration would cut it off.
export const maxDuration = 60;


async function safeGet(path, fallback) {
  try {
    return await backendGet(path);
  } catch (error) {
    return fallback;
  }
}


// The strip of days the dining hall has published — usually today plus about
// two weeks. Server-rendered links, because each day is its own server fetch;
// prefetch is off so hovering the strip doesn't fire thirteen of them.
function DayStrip({ dates, selected, today }) {

  if (dates.length < 2) return null;

  return (
    <nav
      aria-label="Days"
      className="mb-5 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {dates.map(date => {

        const active = date === selected;

        const label = date === today
          ? "Today"
          : DateTime.fromISO(date).toFormat("ccc d");

        return (
          <Link
            key={date}
            href={date === today ? "/food" : `/food?date=${date}`}
            prefetch={false}
            aria-current={active ? "date" : undefined}
            className={`pos-data shrink-0 rounded-[var(--r-pill)] border px-3 py-1.5 text-[0.75rem] transition-colors ${
              active
                ? "border-ink bg-ink text-paper"
                : "border-[var(--line)] text-ink-soft hover:border-ink hover:text-ink"
            }`}
          >
            {label}
          </Link>
        );

      })}
    </nav>
  );

}


export default async function Food({ searchParams }) {

  const params = await searchParams;

  const query = /^\d{4}-\d{2}-\d{2}$/.test(params?.date || "") ? `?date=${params.date}` : "";

  const data = await safeGet(`/api/dining${query}`, { success: false, dates: [], meals: [] });

  const synced = data.lastSynced
    ? DateTime.fromISO(data.lastSynced).toRelative()
    : null;

  return (
    <Page>

      <Reveal gap={70}>

        <div className="pos-reveal" data-reveal>
          <PageHeader title="Dining">
            Every station's menu with full nutrition, straight from the dining
            hall — published about two weeks out.
          </PageHeader>
        </div>

        {!data.success ? (

          <div className="pos-reveal" data-reveal>
            <Empty>
              {data.error ||
                "The menu feed isn't reachable right now. It'll be back with the next sync."}
            </Empty>
          </div>

        ) : data.dates.length === 0 ? (

          <div className="pos-reveal" data-reveal>
            <Empty action={<DiningSyncButton />}>
              No menus stored yet. Sync pulls every station for the next two
              weeks — the first fill runs in slices, so leave it going until
              the count reaches zero. After that, it tops itself up nightly.
            </Empty>
          </div>

        ) : (

          <>

            <div className="pos-reveal" data-reveal>
              <DayStrip dates={data.dates} selected={data.date} today={data.today} />
            </div>

            <div className="pos-reveal" data-reveal>
              <DiningMenu
                key={data.date}
                meals={data.meals}
                suggestedMeal={data.suggestedMeal}
              />
            </div>

            <div className="pos-reveal mt-6 flex flex-wrap items-center justify-between gap-3" data-reveal>
              <Meta>{synced ? `Synced ${synced}.` : "Not synced yet."}</Meta>
              <DiningSyncButton />
            </div>

          </>

        )}

      </Reveal>

    </Page>
  );

}
