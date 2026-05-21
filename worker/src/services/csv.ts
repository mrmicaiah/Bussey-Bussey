/**
 * Minimal RFC 4180-ish CSV parser. Handles:
 *   - Comma delimiter
 *   - Double-quoted fields with embedded commas
 *   - Doubled quotes inside quoted fields ("" → ")
 *   - Bare newlines (treated as record separators; newlines inside
 *     quoted fields are NOT supported in this v1 implementation — see
 *     notes/deferred-cleanup.md if multi-line CSV cells ever surface)
 *
 * Returns `{ headers, rows }` where each row is a Record<header, value>.
 * Unknown rows of different length than the header are reported via
 * `rowErrors` rather than crashing.
 */

export type CsvParseResult = {
  headers: string[];
  rows: Array<Record<string, string>>;
  /** Per-line errors (1-indexed line number, 1 = first data row). */
  rowErrors: Array<{ line: number; reason: string }>;
};

export function parseCsv(text: string): CsvParseResult {
  // Normalize line endings.
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [], rowErrors: [] };
  }
  const headerLine = lines[0] ?? '';
  const headers = parseLine(headerLine).map((h) => h.trim().toLowerCase());

  const rows: Array<Record<string, string>> = [];
  const rowErrors: Array<{ line: number; reason: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const fields = parseLine(raw);
    if (fields.length !== headers.length) {
      rowErrors.push({
        line: i,
        reason: `Column count mismatch (expected ${headers.length}, got ${fields.length})`,
      });
      continue;
    }
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j];
      if (!h) continue;
      obj[h] = (fields[j] ?? '').trim();
    }
    rows.push(obj);
  }
  return { headers, rows, rowErrors };
}

function parseLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    if (line[i] === '"') {
      // Quoted field
      let s = '';
      i++;
      while (i < n) {
        if (line[i] === '"') {
          if (i + 1 < n && line[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          // Closing quote
          i++;
          break;
        }
        s += line[i];
        i++;
      }
      out.push(s);
      // Skip comma if present
      if (i < n && line[i] === ',') i++;
    } else {
      // Bare field
      const start = i;
      while (i < n && line[i] !== ',') i++;
      out.push(line.slice(start, i));
      if (i < n && line[i] === ',') i++;
    }
  }
  // Trailing comma → empty field
  if (line.endsWith(',')) out.push('');
  return out;
}
