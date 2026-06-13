import type { ReactNode } from 'react';

/**
 * Small shared presentational primitives for the Office workspace. Kept in their
 * own module so the panel, progress, and artifact components can all depend on
 * them without forming an import cycle through OfficeTaskPanels.
 */

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{children}</div>
  );
}

export function EmptyLine({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-muted px-3 py-3 text-sm text-text-muted">
      {label}
    </div>
  );
}
