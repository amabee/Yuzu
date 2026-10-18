/** The leaf that sits on a pause point's corner. Purely decorative. */
export function PauseLeaf({
  className = "pause-leaf",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 62 30"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 22C14 6 34 2 58 6 46 22 26 30 4 22Z"
        fill="var(--pause-leaf)"
      />
      <path
        d="M6 21C22 16 38 11 56 7"
        stroke="var(--pause-leaf-vein)"
        strokeWidth="1.6"
        fill="none"
      />
    </svg>
  );
}

/** The faint lemon slice behind a pause point's text. Purely decorative. */
export function PauseSlice({
  className = "pause-slice",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="50"
        cy="50"
        r="47"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />
      <circle cx="50" cy="50" r="39" fill="currentColor" opacity="0.55" />
      <path
        d="M50 13V87M13 50H87M24 24 76 76M24 76 76 24"
        stroke="var(--pause-slice-gap)"
        strokeWidth="2.5"
      />
      <circle cx="50" cy="50" r="5" fill="var(--pause-slice-gap)" />
    </svg>
  );
}
