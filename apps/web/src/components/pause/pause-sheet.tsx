import { PauseSlice } from "./decor";

/** The toast's leaf on a side sheet's corner and the lemon behind it. */
export function PauseSheetDecor() {
  return (
    <>
      <span className="task-panel-leaf" aria-hidden="true" />
      <span className="pause-clip" aria-hidden="true">
        <PauseSlice />
      </span>
    </>
  );
}
