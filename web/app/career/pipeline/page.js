import { backendGet } from "../../backend.js";
import Reveal from "../../Reveal.js";
import CareerNav from "../../CareerNav.js";
import PipelineChart from "../../PipelineChart.js";
import ApplicationList from "../../ApplicationList.js";
import { Page, PageHeader, Card, Empty, Meta, SectionTitle } from "../../ui.js";


export const dynamic = "force-dynamic";


function Stat({ label, value, sub }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.66rem] font-medium uppercase tracking-[0.08em] text-ink-soft">{label}</div>
      <div className="pos-data mt-0.5 text-[1.3rem] leading-none text-ink">{value}</div>
      {sub && <div className="mt-1 text-[0.7rem] text-ink-soft">{sub}</div>}
    </div>
  );
}


export default async function CareerPipeline() {

  const data = await backendGet("/api/jobs?pipeline=1")
    .catch(() => ({ success: false, configured: true }));

  const s = data?.summary;

  return (
    <Page>

      <Reveal gap={70}>

        <div className="pos-reveal" data-reveal>
          <CareerNav />
          <PageHeader title="Pipeline">
            Every application you have logged, and where each one went.
          </PageHeader>
        </div>

        {data?.configured === false ? (

          <div className="pos-reveal" data-reveal>
            <Empty>
              The pipeline tables aren&rsquo;t created yet — run
              <span className="text-ink"> docs/schema-jobs-pipeline.sql </span>
              in Supabase.
            </Empty>
          </div>

        ) : !s || s.applications === 0 ? (

          <div className="pos-reveal" data-reveal>
            <Empty>
              Nothing logged yet. Mark something <span className="text-ink">Applied</span> on
              the Jobs tab and it starts here — then record what happened to it,
              and this becomes the honest picture of the season.
            </Empty>
          </div>

        ) : (

          <>

            <div className="pos-reveal" data-reveal>
              <Card>
                <div className="grid grid-cols-4 gap-3">
                  <Stat label="Applied" value={s.applications} />
                  <Stat label="Advanced" value={s.advanced} sub={s.responseRate != null ? `${s.responseRate}%` : null} />
                  <Stat label="Offers" value={s.offers} />
                  <Stat label="Waiting" value={s.pending} />
                </div>

                <div className="mt-5 border-t border-[var(--line)] pt-4">
                  <PipelineChart nodes={data.nodes} flows={data.flows} />
                </div>

                {/* Silence is inferred, and saying so is the difference between
                    a chart you trust and one you argue with. */}
                <Meta className="mt-3 block">
                  &ldquo;No Response&rdquo; is counted after three weeks of silence — it is
                  never something you have to mark.
                </Meta>
              </Card>
            </div>

            <div className="pos-reveal mt-6" data-reveal>
              <SectionTitle count={data.applications?.length || 0}>Applications</SectionTitle>
              <ApplicationList applications={data.applications || []} />
            </div>

          </>

        )}

      </Reveal>

    </Page>
  );

}
