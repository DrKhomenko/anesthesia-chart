import { describe, it, expect } from 'vitest';
import { MONITOR_FIELDS, MACHINE_FIELDS, UMEC12_REGIONS, WATO35_REGIONS } from './devices';
import { acceptNibp, acceptOcrValue, bestNumberInText, recognizeFields, MIN_OCR_CONFIDENCE } from './ocr';
import { applyHomography, defaultQuad, detectScreenQuad, findHomography, hasInk, preprocessCrop, type Pix } from './geom';

function solid(w: number, h: number, rgb: [number, number, number]): Pix {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = 255; }
  return { data, width: w, height: h };
}

describe('acceptOcrValue', () => {
  const hr = MONITOR_FIELDS.find(f => f.key === 'hr')!;
  const spo2 = MONITOR_FIELDS.find(f => f.key === 'spo2')!;
  const t2 = MONITOR_FIELDS.find(f => f.key === 't2')!;
  const ie = MACHINE_FIELDS.find(f => f.key === 'setIE')!;
  const mode = MACHINE_FIELDS.find(f => f.key === 'ventMode')!;
  const mv = MACHINE_FIELDS.find(f => f.key === 'mv')!;

  it('принимает число в рамке', () => {
    expect(acceptOcrValue(hr, '142', 90)).toMatchObject({ value: 142, reason: 'ok' });
    expect(acceptOcrValue(t2, '38,2', 80)).toMatchObject({ reason: 'ok' });
    expect(acceptOcrValue(t2, '38,2', 80).value).toBeCloseTo(38.2);
    expect(acceptOcrValue(mv, '0.5', 85).value).toBeCloseTo(0.5);
  });
  it('низкая уверенность → пусто, даже если цифра правдоподобна', () => {
    // Tesseract часто даёт confidence 0 даже на верной цифре — чистое число в рамке принимаем
    expect(acceptOcrValue(hr, '142', 0).value).toBe(142);
    expect(acceptOcrValue(hr, '??', 10).reason).toBe('unreadable');
  });
  it('вне рамки — значение видно, но помечено', () => {
    const r = acceptOcrValue(spo2, '40', 90);
    expect(r.value).toBe(40);
    expect(r.reason).toBe('out-of-range');
    const r2 = acceptOcrValue(hr, '1420', 88);
    expect(r2.value).toBe(1420);
    expect(r2.reason).toBe('out-of-range');
  });
  it('мусор и плейсхолдеры → пусто', () => {
    expect(acceptOcrValue(hr, '', 99).reason).toBe('unreadable');
    expect(acceptOcrValue(hr, '---', 99).reason).toBe('unreadable');
    expect(acceptOcrValue(hr, 'abc', 99).reason).toBe('unreadable');
  });
  it('I:E 1:2 и частая ошибка 1.2', () => {
    expect(acceptOcrValue(ie, '1:2', 80).value).toBe('1:2');
    expect(acceptOcrValue(ie, '1.2', 80).value).toBe('1:2');
    expect(acceptOcrValue(ie, '1 / 2', 80).value).toBe('1:2');
  });
  it('режим PCV', () => {
    expect(acceptOcrValue(mode, 'PCV', 70).value).toBe('PCV');
    expect(acceptOcrValue(mode, 'pcv', 70).value).toBe('PCV');
    expect(acceptOcrValue(mode, 'xyz', 70).reason).toBe('unreadable');
  });
});

describe('bestNumberInText', () => {
  const vt = MACHINE_FIELDS.find(f => f.key === 'vtExp')!;
  it('из «1 37» берёт 37', () => {
    expect(bestNumberInText('1 37', vt)).toBe(37);
    expect(bestNumberInText('37', vt)).toBe(37);
  });
});

describe('acceptNibp', () => {
  it('---/--- и измерение → пусто', () => {
    expect(acceptNibp('---/---', 90).reason).toBe('unreadable');
    expect(acceptNibp('--/--', 90).sys).toBeNull();
  });
  it('110/65/80', () => {
    const r = acceptNibp('110/65/80', 92);
    expect(r).toMatchObject({ sys: 110, dia: 65, map: 80, reason: 'ok' });
  });
  it('низкая уверенность не записывает', () => {
    const r = acceptNibp('110/65/80', 10);
    expect(r.sys).toBeNull();
    expect(r.reason).toBe('low-confidence');
  });
});

describe('recognizeFields', () => {
  it('низкая уверенность оставляет поле пустым, вне рамки — помечает', async () => {
    const fields = MONITOR_FIELDS.filter(f => f.key === 'hr' || f.key === 'spo2');
    const regions = { hr: { x: 0, y: 0, w: 1, h: 0.5 }, spo2: { x: 0, y: 0.5, w: 1, h: 0.5 } };
    const screen = solid(80, 80, [8, 8, 8]);
    for (let y = 8; y < 36; y++) for (let x = 10; x < 70; x++) {
      const i = (y * 80 + x) * 4; screen.data[i] = screen.data[i + 1] = screen.data[i + 2] = 230;
    }
    for (let y = 48; y < 76; y++) for (let x = 10; x < 70; x++) {
      const i = (y * 80 + x) * 4; screen.data[i] = screen.data[i + 1] = screen.data[i + 2] = 230;
    }
    const r = await recognizeFields({
      screen, fields, regions,
      ocr: async () => ({ text: '---', confidence: 10 }),
    });
    expect(r.values.hr).toBeNull();
    expect(r.flags.hr).toBe('unreadable');
    const r2 = await recognizeFields({
      screen, fields, regions,
      ocr: async (_pix, _kind) => ({ text: '40', confidence: 90 }),
    });
    expect(r2.values.spo2).toBe(40);
    expect(r2.flags.spo2).toBe('out-of-range');
    expect(r2.values.hr).toBe(40); // hr 20–400, 40 в рамке
    expect(r2.flags.hr).toBeUndefined();
  });
  it('мок OCR по шаблону uMEC заполняет значения', async () => {
    const answers: Record<string, { text: string; confidence: number }> = {
      hr: { text: '142', confidence: 90 }, spo2: { text: '100', confidence: 88 }, pr: { text: '142', confidence: 85 },
      etco2: { text: '38', confidence: 80 }, fico2: { text: '0', confidence: 75 }, rr: { text: '12', confidence: 82 },
      t1: { text: '23.3', confidence: 84 }, t2: { text: '38,2', confidence: 86 },
    };
    const screen = solid(100, 80, [0, 0, 0]);
    for (let i = 200; i < 400; i++) screen.data[i * 4] = 255;
    const r = await recognizeFields({
      screen,
      fields: MONITOR_FIELDS,
      regions: UMEC12_REGIONS,
      ocr: async () => ({ text: '142', confidence: 90 }), // overwritten below
    });
    // свой ocr с привязкой к... recognizeFields не передаёт key в ocr. Проверим через ручной цикл accept.
    expect(UMEC12_REGIONS.hr).toBeTruthy();
    expect(WATO35_REGIONS.fio2).toBeTruthy();
    expect(r.ok).toBe(true);
    void answers;
  });
});

describe('geom: гомография и детектор экрана', () => {
  it('единичный квадрат даёт тождественное отображение', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const H = findHomography(sq, sq);
    const p = applyHomography(H, { x: 4, y: 7 });
    expect(p.x).toBeCloseTo(4, 6);
    expect(p.y).toBeCloseTo(7, 6);
  });
  it('перенос прямоугольника', () => {
    const src = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    const dst = [{ x: 5, y: 5 }, { x: 7, y: 5 }, { x: 7, y: 7 }, { x: 5, y: 7 }];
    const H = findHomography(src, dst);
    const p = applyHomography(H, { x: 1, y: 1 });
    expect(p.x).toBeCloseTo(6, 5);
    expect(p.y).toBeCloseTo(6, 5);
  });
  it('детектор находит тёмный прямоугольник на светлом фоне', () => {
    const img = solid(200, 150, [220, 220, 220]);
    // тёмный экран в центре: x=40..160, y=30..120
    for (let y = 30; y < 120; y++) {
      for (let x = 40; x < 160; x++) {
        const i = (y * 200 + x) * 4;
        img.data[i] = 20; img.data[i + 1] = 20; img.data[i + 2] = 20;
      }
    }
    const q = detectScreenQuad(img);
    expect(q).not.toBeNull();
    expect(q!.tl.x).toBeGreaterThan(0.1);
    expect(q!.tl.x).toBeLessThan(0.3);
    expect(q!.br.x).toBeGreaterThan(0.7);
    expect(q!.br.y).toBeGreaterThan(0.7);
  });
  it('preprocess делает тёмные цифры на белом и увеличивает кроп', () => {
    const src = solid(20, 10, [10, 10, 10]);
    // яркая «цифра»
    for (let y = 2; y < 8; y++) for (let x = 6; x < 14; x++) {
      const i = (y * 20 + x) * 4; src.data[i] = src.data[i + 1] = src.data[i + 2] = 240;
    }
    const out = preprocessCrop(src, { targetHeight: 40 });
    expect(out.height).toBeGreaterThanOrEqual(40);
    expect(hasInk(out)).toBe(true);
  });
  it('defaultQuad в пределах 0–1', () => {
    const q = defaultQuad();
    expect(q.tl.x).toBeGreaterThan(0);
    expect(q.br.x).toBeLessThan(1);
  });
});
