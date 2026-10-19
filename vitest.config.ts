import { defineConfig } from 'vitest/config';

// No test here calls the Claude API (D-2). The `*.live.test.ts` exclusion is the
// Use-Case Studio pattern (src/lib/kickoff/*.live.test.ts, run only by hand with a flag);
// Triage has no live test until Phase 2, and then only behind TRIAGE_LIVE=1.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.live.test.ts'],
    passWithNoTests: true, // task 1.1: green on an empty suite
  },
});
