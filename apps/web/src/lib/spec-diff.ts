export interface SpecDiffLine {
  readonly kind: "context" | "added" | "removed" | "omitted";
  readonly text: string;
}

const MAX_CHANGED_LINES = 200;

/**
 * Produces a bounded, review-oriented diff without an unbounded LCS allocation.
 * The unchanged prefix and suffix locate the changed region; large regions are
 * truncated because a complete diff is still available from the immutable
 * revisions.
 */
export function specLineDiff(previous: string, current: string): readonly SpecDiffLine[] {
  const before = previous.split("\n");
  const after = current.split("\n");
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
    prefix += 1;

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix += 1;

  const lines: SpecDiffLine[] = [];
  if (prefix > 0) lines.push({ kind: "context", text: before[prefix - 1] ?? "" });

  const changed = [
    ...before.slice(prefix, before.length - suffix).map((text) => ({
      kind: "removed" as const,
      text,
    })),
    ...after.slice(prefix, after.length - suffix).map((text) => ({
      kind: "added" as const,
      text,
    })),
  ];
  lines.push(...changed.slice(0, MAX_CHANGED_LINES));
  if (changed.length > MAX_CHANGED_LINES)
    lines.push({
      kind: "omitted",
      text: `${changed.length - MAX_CHANGED_LINES} líneas adicionales omitidas`,
    });
  if (suffix > 0) lines.push({ kind: "context", text: after[after.length - suffix] ?? "" });
  return lines;
}
