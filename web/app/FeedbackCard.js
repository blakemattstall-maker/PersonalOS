// Renders the grading output from either practice type. Deliberately blunt in
// tone to match — this isn't encouragement, it's the thing that's supposed to
// actually make the user better.

function List({ title, items }) {

  if (!items || items.length === 0) return null;

  return (
    <div>
      <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">{title}</div>
      <ul className="mt-1 space-y-1 text-sm text-ink">
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  );

}


export default function FeedbackCard({ type, feedback }) {

  if (!feedback) return null;

  return (
    <div className="mt-4 space-y-4 border-t border-[var(--line)] pt-4">

      <div className="rounded-item bg-moss-wash px-4 py-3.5">
        <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-moss">Verdict</div>
        <p className="mt-1 text-sm text-ink">{feedback.overall}</p>
      </div>

      {type === "debate" && (
        <>
          <List title="What worked" items={feedback.strengths} />
          <List title="What weakened it" items={feedback.weaknesses} />
          <List title="Ground you gave up for no reason" items={feedback.conceded_unnecessarily} />
          <List title="Fallacies" items={feedback.fallacies_noted} />
        </>
      )}

      {type === "pitch" && (
        <>
          {feedback.clarity && (
            <div>
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">Clarity</div>
              <p className="mt-1 text-sm text-ink">{feedback.clarity}</p>
            </div>
          )}
          {feedback.filler_word_note && (
            <div>
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
                Filler words
                {feedback.filler_counts && Object.keys(feedback.filler_counts).length > 0 && (
                  <span className="ml-2 normal-case text-ink-soft">
                    ({Object.entries(feedback.filler_counts).map(([w, n]) => `"${w}" ×${n}`).join(", ")})
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-ink">{feedback.filler_word_note}</p>
            </div>
          )}
          {/* Explainer-only. A generated-topic session is graded on whether he
              understood the concept, so it returns these two instead of the
              persuasion fields — both rubrics share everything else. */}
          {feedback.depth_verdict && (
            <div>
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">
                Understood it, or recited it
              </div>
              <p className="mt-1 text-sm text-ink">{feedback.depth_verdict}</p>
            </div>
          )}
          {feedback.strongest_moment && (
            <div>
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">Strongest moment</div>
              <p className="mt-1 text-sm text-ink">&ldquo;{feedback.strongest_moment}&rdquo;</p>
            </div>
          )}
          <List title="Got wrong" items={feedback.accuracy_notes} />
          <List title="Contradictions" items={feedback.contradictions} />
        </>
      )}

      {feedback.one_thing_to_work_on && (
        <div>
          <div className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-ink-soft">Work on next</div>
          <p className="mt-1 text-sm text-ink">{feedback.one_thing_to_work_on}</p>
        </div>
      )}

    </div>
  );

}
