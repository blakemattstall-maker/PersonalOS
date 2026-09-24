// Small, dependency-free Markdown renderer for model-written text.
//
// Almanac stores answers as plain strings. Models often put useful structure in
// those strings (headings, lists, emphasis and links), but rendering the string
// directly exposes the punctuation instead: "###", "**" and citation brackets.
// This renderer handles the deliberately small subset an answer needs without
// accepting HTML, so stored model output can never inject markup or scripts.

function cleanCitations(value) {
  return String(value || "")
    .replace(/【\d+(?:[-–]\d+)?†[^】]+】/g, "")
    .replace(/\[(?:\d+(?:\s*[-–,]\s*\d+)*)\](?!\()/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}


function Inline({ text }) {

  const value = cleanCitations(text);
  const token = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|https?:\/\/[^\s<]+)/g;
  const parts = value.split(token).filter(Boolean);

  return parts.map((part, index) => {

    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) {
      return (
        <a
          key={index}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-ink underline decoration-[var(--line)] underline-offset-[3px] hover:decoration-[var(--ink)]"
        >
          {link[1]}<span aria-hidden="true"> ↗</span>
        </a>
      );
    }

    if (/^\*\*[^*]+\*\*$/.test(part) || /^__[^_]+__$/.test(part)) {
      return <strong key={index} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
    }

    if (/^\*[^*]+\*$/.test(part)) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }

    if (/^`[^`]+`$/.test(part)) {
      return <code key={index} className="rounded bg-[var(--sunken)] px-1 py-0.5 text-[0.9em]">{part.slice(1, -1)}</code>;
    }

    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-ink underline decoration-[var(--line)] underline-offset-[3px] hover:decoration-[var(--ink)]"
        >
          {part}<span aria-hidden="true"> ↗</span>
        </a>
      );
    }

    return part;

  });

}


function isBlockStart(line) {
  return /^\s*(?:#{1,6}\s*|[-*+]\s+|\d+[.)]\s+|>\s*|```|\|)/.test(line);
}


function tableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
}


function isTableDivider(line) {
  const cells = tableCells(line);
  return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}


export default function FormattedText({ text, className = "" }) {

  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];

  for (let i = 0; i < lines.length;) {

    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    if (/^\s*```/.test(line)) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i += 1;
      blocks.push(<pre key={`code-${i}`} className="overflow-x-auto rounded-item bg-[var(--sunken)] p-3 text-[0.8rem]"><code>{code.join("\n")}</code></pre>);
      continue;
    }

    const heading = line.match(/^\s*#{1,6}\s*(.+)$/);
    if (heading) {
      blocks.push(<h4 key={`heading-${i}`} className="pos-display pt-1 text-[1rem] text-ink"><Inline text={heading[1]} /></h4>);
      i += 1;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const headings = tableCells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(tableCells(lines[i++]));
      blocks.push(
        <div key={`table-${i}`} className="overflow-x-auto rounded-item border border-[var(--line)]">
          <table className="w-full min-w-[28rem] border-collapse text-left text-[0.82rem]">
            <thead className="bg-[var(--sunken)]">
              <tr>{headings.map((cell, j) => <th key={j} className="border-b border-[var(--line)] px-3 py-2 font-semibold text-ink"><Inline text={cell} /></th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-[var(--line)] last:border-b-0">
                  {headings.map((_, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top"><Inline text={row[cellIndex] || ""} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ""));
      blocks.push(
        <ul key={`ul-${i}`} className="space-y-1.5 pl-5">
          {items.map((item, j) => <li key={j} className="list-disc pl-1"><Inline text={item} /></li>)}
        </ul>
      );
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push(
        <ol key={`ol-${i}`} className="space-y-1.5 pl-5">
          {items.map((item, j) => <li key={j} className="list-decimal pl-1"><Inline text={item} /></li>)}
        </ol>
      );
      continue;
    }

    if (/^\s*>\s*/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s*/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s*/, ""));
      blocks.push(<blockquote key={`quote-${i}`} className="border-l-2 border-[var(--line)] pl-3 text-ink-soft"><Inline text={quote.join(" ")} /></blockquote>);
      continue;
    }

    const paragraph = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) paragraph.push(lines[i++].trim());
    blocks.push(<p key={`p-${i}`}><Inline text={paragraph.join(" ")} /></p>);

  }

  if (blocks.length === 0) return null;

  return (
    <div className={`min-w-0 space-y-3 [overflow-wrap:anywhere] leading-relaxed text-ink ${className}`}>
      {blocks}
    </div>
  );

}
