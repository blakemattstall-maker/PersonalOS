import { backendGet } from "../../backend.js";
import ProjectCard from "../../ProjectCard.js";
import { Page, PageHeader, Empty } from "../../ui.js";


export const dynamic = "force-dynamic";


async function safeGet(path, fallback) {
  try {
    return await backendGet(path);
  } catch (error) {
    return fallback;
  }
}


export default async function ArchivedProjects() {

  const data = await safeGet("/api/projects?status=archived", { success: false, projects: [] });
  const projects = data.projects || [];

  return (
    <Page>

      <PageHeader title="Archived projects">
        Put away, not deleted — every task and event stays exactly where it
        is. Restore one to bring it back to Today.
      </PageHeader>

      {projects.length === 0 ? (
        <Empty>Nothing archived. Projects you put away from Today show up here.</Empty>
      ) : (
        <div className="space-y-3">
          {projects.map(project => (
            <ProjectCard key={project.id} project={project} archived />
          ))}
        </div>
      )}

    </Page>
  );

}
