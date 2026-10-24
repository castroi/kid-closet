import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom does not implement object URLs.
if (typeof URL.createObjectURL !== 'function') {
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = () => undefined;
}

afterEach(() => {
  cleanup();
});
