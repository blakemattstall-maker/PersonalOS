import { backendGet } from "../backend.js";
import BodyCard from "../BodyCard.js";
import Reveal from "../Reveal.js";
import { Page, PageHeader } from "../ui.js";

export const dynamic = "force-dynamic";

export default async function Health() {
  const body = await backendGet("/api/health")
    .catch(() => ({ success: false, vitals: null }));

  return (
    <Page>
      <Reveal gap={70}>
        <div className="pos-reveal" data-reveal>
          <PageHeader title="Health">Weight, pace, and progress from your body data.</PageHeader>
        </div>
        <div className="pos-reveal" data-reveal>
          <BodyCard vitals={body?.vitals || null} />
        </div>
      </Reveal>
    </Page>
  );
}
