import Reveal from "../../Reveal.js";
import { Page, PageHeader, Card } from "../../ui.js";

export default function CareerPipeline() {
  return (
    <Page>
      <Reveal gap={70}>
        <div className="pos-reveal" data-reveal>
          <PageHeader title="Pipeline">Internship tracking is paused.</PageHeader>
        </div>
        <div className="pos-reveal" data-reveal>
          <Card tone="sunken">
            <p className="text-sm leading-relaxed text-ink-soft">
              Existing application history is preserved while Intern Insider handles the active search.
            </p>
          </Card>
        </div>
      </Reveal>
    </Page>
  );
}
