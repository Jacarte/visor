import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globalSetup: ['tests/setup-worker.ts'], include: ['tests/**/*.test.ts'], environment: 'node' } });
