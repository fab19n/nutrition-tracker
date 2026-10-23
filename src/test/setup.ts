import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { configure } from '@testing-library/react';

// findBy* and waitFor without their own timeout: 3 s instead of 1 s. A live query over a seeded
// diary can take longer than a second when every core runs a test file (vite.config.ts test budgets).
configure({ asyncUtilTimeout: 3_000 });
