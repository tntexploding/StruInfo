import {defineConfig} from 'vite';
const proxy = {
  '/api': process.env.STRUIINFO_API_ORIGIN ?? 'http://127.0.0.1:32100',
  '/health': process.env.STRUIINFO_API_ORIGIN ?? 'http://127.0.0.1:32100',
};
export default defineConfig({
  build: {target: 'esnext', emptyOutDir: true, outDir: 'dist'},
  server: {host: '127.0.0.1', proxy},
  preview: {host: '127.0.0.1', proxy},
});
