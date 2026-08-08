import Link from "next/link";
import SettingsPanel from "../SettingsPanel.js";
import { backendGet } from "../backend.js";
import Reveal from "../Reveal.js";
import { Page, PageHeader, Card } from "../ui.js";


export const dynamic = "force-dynamic";


async function safeGet(path, fallback) {

  try {

    return await backendGet(path);

  } catch (error) {

    return fallback;

  }

}


// The two pages that don't earn a tab of their own. Both are "look back or
// clean up" jobs, which is what this page already is.
const ELSEWHERE = [
  {
    href: "/data",
    title: "What it knows",
    blurb: "Every memory, note and intention it has saved. Delete anything wrong."
  },
  {
    href: "/history",
    title: "Earlier",
    blurb: "Past briefs, and everything you've already cleared."
  },
  {
    href: "/settings/archived",
    title: "Archived projects",
    blurb: "Projects you've put away. Nothing is deleted — restore one anytime."
  }
];


export default async function Settings() {

  const [settings, diagnostics] = await Promise.all([
    safeGet("/api/settings", { settings: null }),
    safeGet("/api/diag", { success: false })
  ]);

  return (
    <Page>

      <Reveal gap={70}>

      <div className="pos-reveal" data-reveal>
        <PageHeader title="Settings" />
      </div>

      <div className="pos-reveal" data-reveal>
      <Card className="mb-2">
        <div className="-my-1">
          {ELSEWHERE.map(entry => (
            <Link
              key={entry.href}
              href={entry.href}
              className="flex items-center gap-3 border-t border-[var(--line)] py-3.5 first:border-t-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[0.92rem] font-medium text-ink">{entry.title}</span>
                <span className="mt-0.5 block text-[0.8rem] leading-snug text-ink-soft">
                  {entry.blurb}
                </span>
              </span>
              <span className="shrink-0 text-ink-soft" aria-hidden="true">›</span>
            </Link>
          ))}
        </div>
      </Card>
      </div>

      <div className="pos-reveal" data-reveal>
      <SettingsPanel
        initialSettings={settings?.settings || null}
        initialDiagnostics={diagnostics}
      />
      </div>

      </Reveal>

    </Page>
  );

}
