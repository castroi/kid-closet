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

// jsdom has no usable PointerEvent: without one, fireEvent.pointerDown/Up drop clientX/clientY,
// so a test swipe looks like a tap. Install a minimal one only when coordinates would be lost.
function pointerEventKeepsCoordinates(): boolean {
  try {
    return typeof window.PointerEvent === 'function' && new window.PointerEvent('pointerdown', { clientX: 5 }).clientX === 5;
  } catch {
    return false;
  }
}
// Node-environment test files load this setup too; they have no window or MouseEvent.
if (typeof window !== 'undefined' && typeof MouseEvent === 'function' && !pointerEventKeepsCoordinates()) {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'touch';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
}

afterEach(() => {
  cleanup();
});
