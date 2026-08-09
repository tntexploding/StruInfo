import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: 'dist',
  },
  server: {host: '127.0.0.1'},
  preview: {host: '127.0.0.1'},
});
