import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['test-e2e.ts', 'pentest.ts'], testTimeout: 30_000, hookTimeout: 30_000, fileParallelism: false } });
