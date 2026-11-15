/** The most bytes of a binary body the hex view shows; the rest is left to the base64 copy. */
export const HEX_VIEW_MAX_BYTES = 512;

/** The hex view of a binary body: rows of 16 bytes as offset, hex and printable ASCII, bounded to `maxBytes`. */
export interface HexView {
  rows: string[];
  shownBytes: number;
  totalBytes: number;
}

/** True when the string is base64 the browser decodes; an empty string is not a body worth sending as binary. */
export function isBase64(value: string): boolean {
  if (!value || !/^[A-Za-z0-9+/\s]*={0,2}$/.test(value)) {
    return false;
  }
  try {
    atob(value.replace(/\s/g, ''));
    return true;
  } catch {
    return false;
  }
}

/** Decodes a base64 body and lays out at most `maxBytes` of it as hex rows; the bytes themselves are never changed. */
export function hexView(base64: string, maxBytes = HEX_VIEW_MAX_BYTES): HexView {
  const binary = atob(base64);
  const shown = Math.min(binary.length, maxBytes);
  const rows: string[] = [];
  for (let offset = 0; offset < shown; offset += 16) {
    const codes = Array.from({ length: Math.min(16, shown - offset) }, (_, i) => binary.charCodeAt(offset + i));
    const hex = codes.map(c => c.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const ascii = codes.map(c => (c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.')).join('');
    rows.push(`${offset.toString(16).padStart(8, '0')}  ${hex}  ${ascii}`);
  }
  return { rows, shownBytes: shown, totalBytes: binary.length };
}
