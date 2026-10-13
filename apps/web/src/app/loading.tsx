export default function Loading() {
  return (
    <div role="status" aria-label="Loading workspace" className="space-y-6">
      <span className="sr-only">Loading workspace</span>
      <div className="h-10 w-64 rounded-lg bg-muted" />
      <div className="h-64 rounded-2xl bg-muted" />
    </div>
  );
}
