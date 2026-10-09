import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// This file lives with the web app because npm runs the workspace's `dev` and `build`
// scripts from apps/web, and Vite reads its config only from the folder it starts in.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? '4174'}` },
  },
});
