import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/anesthesia-chart/',
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['icon-180.png', 'ocr/worker.min.js', 'ocr/tesseract-core-lstm.wasm.js', 'ocr/eng.traineddata.gz'],
    manifest: { name: 'Анестезиологическая карта', short_name: 'Наркоз', lang: 'ru', display: 'standalone', orientation: 'landscape',
      background_color: '#000000', theme_color: '#000000', start_url: './', scope: './',
      icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }] },
    workbox: { globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest,wasm,gz}'], maximumFileSizeToCacheInBytes: 8 * 1024 * 1024, navigateFallback: 'index.html', skipWaiting: true, clientsClaim: true },
  })],
  preview: { host: true, allowedHosts: true },
  server: { host: true, allowedHosts: true },
});
