// Renders the grading output from either practice type. Deliberately blunt in
// tone to match — this isn't encouragement, it's the thing that's supposed to
// actually make the user better.

function List({ title, items }) {

  if (!items || items.length === 0) return null;

  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{title}</div>
      <ul className="mt-1 space-y-1 text-sm text-foreground">
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  );

}


export default function FeedbackCard({ type, feedback }) {

  if (!feedback) return null;

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">

      <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3">
        <div className="text-xs font-medium uppercase tracking-wide text-accent">Verdict</div>
        <p className="mt-1 text-sm text-foreground">{feedback.overall}</p>
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
              <div className="text-xs font-medium uppercase tracking-wide text-muted">Clarity</div>
              <p className="mt-1 text-sm text-foreground">{feedback.clarity}</p>
            </div>
          )}
          {feedback.filler_word_note && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Filler words
                {feedback.filler_counts && Object.keys(feedback.filler_counts).length > 0 && (
                  <span className="ml-2 normal-case text-muted">
                    ({Object.entries(feedback.filler_counts).map(([w, n]) => `"${w}" ×${n}`).join(", ")})
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-foreground">{feedback.filler_word_note}</p>
            </div>
          )}
          {/* Explainer-only. A generated-topic session is graded on whether he
              understood the concept, so it returns these two instead of the
              persuasion fields — both rubrics share everything else. */}
          {feedback.depth_verdict && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted">
                Understood it, or recited it
              </div>
              <p className="mt-1 text-sm text-foreground">{feedback.depth_verdict}</p>
            </div>
          )}
          {feedback.strongest_moment && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted">Strongest moment</div>
              <p className="mt-1 text-sm text-foreground">&ldquo;{feedback.strongest_moment}&rdquo;</p>
            </div>
          )}
          <List title="Got wrong" items={feedback.accuracy_notes} />
          <List title="Contradictions" items={feedback.contradictions} />
        </>
      )}

      {feedback.one_thing_to_work_on && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Work on next</div>
          <p className="mt-1 text-sm text-foreground">{feedback.one_thing_to_work_on}</p>
        </div>
      )}

    </div>
  );

}
