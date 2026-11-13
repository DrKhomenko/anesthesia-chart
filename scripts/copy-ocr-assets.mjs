import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(web, 'public/ocr');
mkdirSync(dest, { recursive: true });

// Все LSTM-варианты ядра: tesseract.js выбирает simd / relaxedsimd / обычный по возможностям браузера,
// если corePath указывает на каталог.
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
];
for (const [from, to] of files) {
  const src = join(web, from);
  if (!existsSync(src)) {
    console.error('Missing', from);
    process.exit(1);
  }
  copyFileSync(src, join(dest, to));
}
const trained = join(dest, 'eng.traineddata.gz');
if (!existsSync(trained)) {
  console.error('Missing public/ocr/eng.traineddata.gz — положите пакет языка в эту папку.');
  process.exit(1);
}
const sizes = [...files.map(([, to]) => to), 'eng.traineddata.gz']
  .map(f => `${f} ${(statSync(join(dest, f)).size / 1024 / 1024).toFixed(2)} MB`);
console.log('OCR assets:', sizes.join(', '));
