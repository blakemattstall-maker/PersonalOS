import Reveal from "../../Reveal.js";
import { Page, PageHeader, Card } from "../../ui.js";

export default function CareerJobs() {
  return (
    <Page>
      <Reveal gap={70}>
        <div className="pos-reveal" data-reveal>
          <PageHeader title="Jobs">Internship monitoring is paused.</PageHeader>
        </div>
        <div className="pos-reveal" data-reveal>
          <Card tone="sunken">
            <p className="text-sm leading-relaxed text-ink-soft">
              Almanac is no longer polling job boards, enriching listings, or sending internship alerts. Your saved postings remain stored.
            </p>
          </Card>
        </div>
      </Reveal>
    </Page>
  );
}
