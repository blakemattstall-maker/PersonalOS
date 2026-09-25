export default function AlmanacMark({ className = "", compact = false }) {
  return (
    <svg viewBox="0 0 96 96" role="img" aria-label="Almanac" className={`launch-mark ${compact ? "is-compact" : ""} ${className}`}>
      <circle className="launch-mark__field" cx="48" cy="48" r="43" />
      <ellipse className="launch-mark__orbit launch-mark__orbit--a" cx="48" cy="48" rx="31" ry="15" />
      <ellipse className="launch-mark__orbit launch-mark__orbit--b" cx="48" cy="48" rx="15" ry="31" />
      <path className="launch-mark__orbit launch-mark__orbit--c" d="M20 67c15-6 36-22 55-39" />
      <circle className="launch-mark__core" cx="48" cy="48" r="8" />
      <circle className="launch-mark__node launch-mark__node--one" cx="19" cy="48" r="3.5" />
      <circle className="launch-mark__node launch-mark__node--two" cx="67" cy="28" r="3.5" />
      <circle className="launch-mark__node launch-mark__node--three" cx="62" cy="67" r="3.5" />
    </svg>
  );
}
