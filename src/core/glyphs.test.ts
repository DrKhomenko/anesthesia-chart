import { describe, it, expect } from 'vitest';
import { MACHINE_FIELDS, LEGACY_PRESET_REGIONS, PRESET_WATO_ID, WATO35_REGIONS, sameRegions } from './devices';
import { acceptOcrValue, recognizeFields, whitelistFor } from './ocr';
import { locateGlyphs, type Pix } from './geom';

function canvas(w: number, h: number): Pix {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = 255;
  return { data, width: w, height: h };
}
function rect(p: Pix, x0: number, y0: number, w: number, h: number, rgb: [number, number, number]) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * p.width + x) * 4; p.data[i] = rgb[0]; p.data[i + 1] = rgb[1]; p.data[i + 2] = rgb[2];
  }
}
/** «Цифра» — рамка-контур (как 0), чтобы не была сплошным блоком. */
function digit(p: Pix, x: number, y: number, w: number, h: number, rgb: [number, number, number]) {
  rect(p, x, y, w, 5, rgb); rect(p, x, y + h - 5, w, 5, rgb); rect(p, x, y, 5, h, rgb); rect(p, x + w - 5, y, 5, h, rgb);
}

describe('locateGlyphs', () => {
  it('находит цифры, точку и игнорирует рамку кнопки и мелкую подпись', () => {
    const p = canvas(400, 300);
    // рамка кнопки выходит за область поиска
    rect(p, 0, 40, 400, 3, [200, 200, 200]);
    digit(p, 150, 100, 30, 50, [255, 220, 40]);
    rect(p, 186, 143, 6, 6, [255, 220, 40]); // точка
    digit(p, 198, 100, 30, 50, [255, 220, 40]);
    digit(p, 240, 100, 8, 12, [255, 220, 40]); // мелкая подпись справа
    const g = locateGlyphs(p, { x: 0.35, y: 0.3, w: 0.3, h: 0.25 });
    expect(g).not.toBeNull();
    expect(g!.separators).toEqual([{ index: 1, ch: '.' }]);
    expect(g!.digitCount).toBe(2);
    // ширина кропа — только две цифры с точкой, без подписи
    expect(g!.binary.width).toBeLessThan(200);
  });

  it('пустое поле или прочерки — null', () => {
    const p = canvas(400, 300);
    rect(p, 150, 120, 30, 4, [255, 255, 255]);
    rect(p, 190, 120, 30, 4, [255, 255, 255]);
    expect(locateGlyphs(p, { x: 0.35, y: 0.3, w: 0.3, h: 0.25 })).toBeNull();
  });

  it('вставляет потерянную точку по геометрии', async () => {
    const p = canvas(400, 300);
    digit(p, 150, 100, 30, 50, [80, 180, 255]);
    rect(p, 186, 143, 6, 6, [80, 180, 255]);
    digit(p, 198, 100, 30, 50, [80, 180, 255]);
    const mv = MACHINE_FIELDS.find(f => f.key === 'mv')!;
    const res = await recognizeFields({
      screen: p, fields: [mv], regions: { mv: { x: 0.35, y: 0.3, w: 0.3, h: 0.25 } },
      ocr: async () => ({ text: '05', confidence: 90 }),
    });
    expect(res.values.mv).toBe(0.5);
  });
});

describe('разбор', () => {
  it('I:E без двоеточия «12» → 1:2', () => {
    const ie = MACHINE_FIELDS.find(f => f.key === 'setIE')!;
    expect(acceptOcrValue(ie, '12', 80).value).toBe('1:2');
    expect(acceptOcrValue(ie, '1:2', 80).value).toBe('1:2');
  });
  it('whitelist по виду поля', () => {
    expect(whitelistFor('number')).toBe('0123456789.');
    expect(whitelistFor('nibp')).toContain('/');
  });
  it('старые рамки WATO узнаются, новые отличаются', () => {
    const old = LEGACY_PRESET_REGIONS[PRESET_WATO_ID][0];
    expect(sameRegions({ ...old }, old)).toBe(true);
    expect(sameRegions(WATO35_REGIONS, old)).toBe(false);
  });
});
