import { defineConfig } from 'vitest/config';

// testTimeout: the vector suites read hundreds of folders; under load (several builds at once) 5 s was not enough.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 30000 },
});
