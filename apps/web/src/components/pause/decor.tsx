/** The toast's leaves, sitting on a pause point's corner. Purely decorative. */
export function PauseLeaf({
  className = "pause-leaf",
}: {
  className?: string;
}) {
  return <span className={className} aria-hidden="true" />;
}

/** The toast's lemon slice behind a pause point's text. Purely decorative. */
export function PauseSlice({
  className = "pause-slice",
}: {
  className?: string;
}) {
  return <span className={className} aria-hidden="true" />;
}
