import { backendGet } from "../../backend.js";
import Reveal from "../../Reveal.js";
import CareerNav from "../../CareerNav.js";
import JobsView from "../../JobsView.js";
import ManualTargets from "../../ManualTargets.js";
import { Page, PageHeader, Empty } from "../../ui.js";


export const dynamic = "force-dynamic";


export default async function CareerJobs() {

  const [feed, settings] = await Promise.all([
    backendGet("/api/jobs").catch(() => ({ success: false, configured: true, postings: [] })),
    backendGet("/api/settings").catch(() => ({ settings: {} }))
  ]);

  return (
    <Page>

      <Reveal gap={70}>

        <div className="pos-reveal" data-reveal>
          <CareerNav />
          <PageHeader title="Jobs">
            Internships, caught the moment they post. Checked every fifteen
            minutes across {feed.watching || 0} company boards.
          </PageHeader>
        </div>

        {feed.configured === false ? (

          <div className="pos-reveal" data-reveal>
            <Empty>
              The watchlist tables aren&rsquo;t created yet — run
              <span className="text-ink"> docs/schema-jobs.sql </span>
              in Supabase, then <span className="text-ink">node scripts/seed-jobs.mjs</span>.
            </Empty>
          </div>

        ) : (

          <div className="pos-reveal" data-reveal>
            <JobsView
              postings={feed.postings || []}
              watching={feed.watching || 0}
              broken={feed.broken || []}
              lastCheckedAt={feed.lastCheckedAt || null}
              locationPriority={feed.locationPriority !== false}
            />
          </div>

        )}

        {/* Always shown, even when the feed is empty or unconfigured — these
            are the places that do not depend on any of it working. */}
        <div className="pos-reveal" data-reveal>
          <ManualTargets checks={settings?.settings?.manual_checks || {}} />
        </div>

      </Reveal>

    </Page>
  );

}
