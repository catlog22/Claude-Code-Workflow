import '@testing-library/jest-dom/vitest';

// Minimal ResizeObserver polyfill for components that render in JSDOM.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = MockResizeObserver;

