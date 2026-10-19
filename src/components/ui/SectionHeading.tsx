import type { ReactNode } from 'react';

/** "TOP 3 THIS WEEK" style heading: 13px/700, +0.02em, uppercase, --muted; 18px top / 8px bottom, 20px sides. */
export function SectionHeading({ children, inset = 20, as: Tag = 'h2' }: { children: ReactNode; inset?: number; as?: 'h2' | 'h3' | 'div' }) {
  return (
    <Tag className="t-section" style={{ margin: 0, padding: `18px ${inset}px 8px` }}>
      {children}
    </Tag>
  );
}
