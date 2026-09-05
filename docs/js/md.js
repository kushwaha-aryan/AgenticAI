function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMarkdown(s) {
  const codes = [];
  let out = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(escapeHtml(c));
    return "\u0001CODE" + (codes.length - 1) + "\u0001";
  });
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  out = out.replace(/\u0001CODE(\d+)\u0001/g, (_, i) => "<code>" + codes[Number(i)] + "</code>");
  return out;
}

function splitTableRow(line) {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((s) => s.trim());
}

function isTableSeparator(line) {
  return /^\s*\|?[\s:|-]*[-][\s:|-]*\|?\s*$/.test(line.trim());
}

function buildTable(rows) {
  const header = splitTableRow(rows[0]);
  let start = 1;
  if (rows.length > 1 && isTableSeparator(rows[1])) {
    start = 2;
  }
  let html = "<table><thead><tr>";
  header.forEach((c) => {
    html += "<th>" + inlineMarkdown(c) + "</th>";
  });
  html += "</tr></thead><tbody>";
  for (let j = start; j < rows.length; j++) {
    html += "<tr>";
    splitTableRow(rows[j]).forEach((c) => {
      html += "<td>" + inlineMarkdown(c) + "</td>";
    });
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
}

function markdownToHtml(text) {
  const source = String(text || "");
  const lines = escapeHtml(source).split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      i++;
      continue;
    }

    if (/^```/.test(t)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push("<pre><code>" + buf.join("\n") + "</code></pre>");
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(lines[i]);
        i++;
      }
      out.push(buildTable(rows));
      continue;
    }

    if (/^#{1,3}\s+/.test(t)) {
      const level = t.match(/^#+/)[0].length;
      out.push("<h" + level + ">" + inlineMarkdown(t.replace(/^#+\s*/, "")) + "</h" + level + ">");
      i++;
      continue;
    }
    if (/^#{4,6}\s+/.test(t)) {
      out.push("<h6>" + inlineMarkdown(t.replace(/^#+\s*/, "")) + "</h6>");
      i++;
      continue;
    }
    if (/^[-*_](?:\s*[-*_]){2,}\s*$/.test(t)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^&gt;\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^&gt;\s?/, ""));
        i++;
      }
      out.push("<blockquote>" + buf.map(inlineMarkdown).join("<br>") + "</blockquote>");
      continue;
    }
    if (/^[-*]\s+/.test(t) || /^\u25cf\s+/.test(t)) {
      const items = [];
      while (i < lines.length && (/^[-*]\s+/.test(lines[i].trim()) || /^\u25cf\s+/.test(lines[i].trim()))) {
        items.push(inlineMarkdown(lines[i].trim().replace(/^[-*\u25cf]\s*/, "")));
        i++;
      }
      out.push("<ul>" + items.map((it) => "<li>" + it + "</li>").join("") + "</ul>");
      continue;
    }
    if (/^\d+[.)]\s+/.test(t)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(inlineMarkdown(lines[i].trim().replace(/^\d+[.)]\s*/, "")));
        i++;
      }
      out.push("<ol>" + items.map((it) => "<li>" + it + "</li>").join("") + "</ol>");
      continue;
    }

    const buf = [];
    while (i < lines.length) {
      const cur = lines[i].trim();
      if (!cur) break;
      if (/^```/.test(cur)) break;
      if (/^#{1,6}\s+/.test(cur)) break;
      if (/^[-*_](?:\s*[-*_]){2,}\s*$/.test(cur)) break;
      if (/^&gt;\s?/.test(lines[i])) break;
      if (/^[-*\u25cf]\s+/.test(cur) || /^\d+[.)]\s+/.test(cur)) break;
      if (lines[i].includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) break;
      buf.push(lines[i].trim());
      i++;
    }
    if (buf.length) {
      out.push("<p>" + buf.map(inlineMarkdown).join("<br>") + "</p>");
    }
  }
  return out.join("\n");
}

function renderMarkdown(el, text) {
  el.innerHTML = markdownToHtml(text);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { markdownToHtml, inlineMarkdown, escapeHtml, renderMarkdown };
}