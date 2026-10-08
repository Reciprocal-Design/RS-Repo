import { describe, expect, it } from 'vitest';
import { moduleScene } from '../core/modules';
import { crc32, frameName, ZipWriter } from './sequenceExport';

describe('PNG sequence', () => {
  it('names frames in order, zero-padded', () => {
    const s = moduleScene('journey', 7);
    expect(frameName(s, 0)).toBe('cell-tissue-body_0001.png');
    expect(frameName(s, 449)).toBe('cell-tissue-body_0450.png');
    expect(frameName(s, 9, 5)).toBe('cell-tissue-body_00010.png');
  });

  it('writes a valid stored ZIP', async () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const z = new ZipWriter();
    z.add('a.png', new Uint8Array([1, 2, 3]));
    z.add('b.png', new Uint8Array([4, 5]));
    const bytes = new Uint8Array(await z.finish().arrayBuffer());
    const view = new DataView(bytes.buffer);
    // Local header, then the data, for the first file.
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect([...bytes.slice(30 + 5, 30 + 5 + 3)]).toEqual([1, 2, 3]);
    // End of central directory: two entries, pointing at the central directory.
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const cd = view.getUint32(end + 16, true);
    expect(view.getUint32(cd, true)).toBe(0x02014b50);
  });
});
