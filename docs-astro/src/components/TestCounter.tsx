import { useState } from 'react';

export default function TestCounter() {
  const [count, setCount] = useState(0);

  return (
    <div className="p-4 border border-border rounded-md bg-surface">
      <h3 className="text-lg font-semibold mb-2">React Island Test</h3>
      <p className="text-text-secondary mb-4">
        Count: <span className="font-bold text-accent">{count}</span>
      </p>
      <button
        onClick={() => setCount(count + 1)}
        className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity"
      >
        Increment
      </button>
    </div>
  );
}
