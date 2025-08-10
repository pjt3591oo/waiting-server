import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: [
        'src/index.js',
        'src/config/**',
        '**/*.test.js'
      ]
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});