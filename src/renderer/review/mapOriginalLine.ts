/** A line change as Monaco's `IDiffEditor.getLineChanges()` reports it (an end of 0 means an empty side). */
export type LineChange = {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
};

const length = (start: number, end: number) =>
  end === 0 ? 0 : end - start + 1;

/**
 * The modified line that matches original line `line` (0 is "above the first line"), so a
 * before-side comment can sit in the inline view, which shows the modified editor only.
 * Inside a change it maps to the change's last modified line; for a pure deletion, Monaco
 * already reports `modifiedStartLineNumber` as the line before the gap. Outside a change the
 * line shifts by the lines added or removed above it.
 */
export function mapOriginalLine(
  line: number,
  changes: readonly LineChange[],
): number {
  if (line <= 0) return 0;
  let shift = 0;
  for (const c of changes) {
    const origLen = length(c.originalStartLineNumber, c.originalEndLineNumber);
    const modLen = length(c.modifiedStartLineNumber, c.modifiedEndLineNumber);
    if (
      origLen > 0 &&
      line >= c.originalStartLineNumber &&
      line <= c.originalEndLineNumber
    )
      return Math.max(
        0,
        modLen > 0 ? c.modifiedEndLineNumber : c.modifiedStartLineNumber,
      );
    // An insertion sits after original line `originalStartLineNumber`.
    const above =
      origLen > 0
        ? c.originalEndLineNumber < line
        : c.originalStartLineNumber < line;
    if (above) shift += modLen - origLen;
  }
  return Math.max(0, line + shift);
}
