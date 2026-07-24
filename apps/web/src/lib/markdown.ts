export function renderSafeMarkdown(markdown: string): string {
  const escaped = escapeHtml(markdown.replaceAll("\r\n", "\n"));
  const blocks: string[] = [];
  const withoutCode = escaped.replace(/```(?:[^\n]*)\n([\s\S]*?)```/gu, (_match, code: string) => {
    const index = blocks.push(`<pre><code>${code.replace(/\n$/u, "")}</code></pre>`) - 1;
    return `\n@@AIWS_CODE_${index}@@\n`;
  });
  const lines = withoutCode.split("\n");
  const output: string[] = [];
  let listOpen = false;
  for (const line of lines) {
    const code = /^@@AIWS_CODE_(\d+)@@$/u.exec(line);
    if (code?.[1] !== undefined) {
      if (listOpen) output.push("</ul>");
      listOpen = false;
      output.push(blocks[Number(code[1])] ?? "");
      continue;
    }
    const bullet = /^[-*] (.+)$/u.exec(line);
    if (bullet?.[1] !== undefined) {
      if (!listOpen) output.push("<ul>");
      listOpen = true;
      output.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    if (listOpen) output.push("</ul>");
    listOpen = false;
    if (line.trim() === "") continue;
    const heading = /^(#{1,3}) (.+)$/u.exec(line);
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      const level = heading[1].length;
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else {
      output.push(`<p>${inline(line)}</p>`);
    }
  }
  if (listOpen) output.push("</ul>");
  return output.join("\n");
}

function inline(value: string): string {
  return value
    .replace(/`([^`]+)`/gu, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
