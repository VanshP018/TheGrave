import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in dev so the refresh-token cookie can be SameSite=Strict.
    proxy: {
      '/api': { target: 'http://localhost:4000' },
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
