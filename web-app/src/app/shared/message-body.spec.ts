import { HEX_VIEW_MAX_BYTES, hexView, isBase64 } from './message-body';

describe('message body', () => {
  it('shows the bytes of a binary body as offset, hex and printable ASCII', () => {
    const view = hexView(btoa(String.fromCharCode(0x00, 0xff, 0x41, 0x42, 0x0a)));

    expect(view.rows, 'One row: offset, the hex of each byte, then a dot for each byte that is not printable').toEqual([
      '00000000  00 ff 41 42 0a' + ' '.repeat(33) + '  ..AB.'
    ]);
    expect(view.shownBytes).toBe(5);
    expect(view.totalBytes).toBe(5);
  });

  it('bounds the hex view to the first bytes of a large body and says how many there are', () => {
    const view = hexView(btoa('x'.repeat(HEX_VIEW_MAX_BYTES + 100)));

    expect(view.shownBytes, 'The hex view stops at its bound').toBe(HEX_VIEW_MAX_BYTES);
    expect(view.rows.length).toBe(HEX_VIEW_MAX_BYTES / 16);
    expect(view.totalBytes, 'The total names every byte, so the note can say what was left out').toBe(HEX_VIEW_MAX_BYTES + 100);
  });

  it('accepts base64 and refuses text that is not', () => {
    expect(isBase64('AP8=')).toBe(true);
    expect(isBase64('not base64!'), 'A body that is not base64 must not be sent as binary').toBe(false);
    expect(isBase64('')).toBe(false);
  });
});
