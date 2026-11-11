import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    proxy: { '/api': { target: 'http://localhost:3000' } },
  },
  test: { environment: 'jsdom' },
});
