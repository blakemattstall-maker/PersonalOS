// Fullscreen like the page it becomes — a SkeletonPage here would flash a
// card-stack layout for a page that has no cards.
export default function Loading() {
  return (
    <div className="fixed inset-0 grid place-items-center bg-paper" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <p className="pos-data text-[0.75rem] text-ink-soft">Assembling the graph…</p>
    </div>
  );
}
