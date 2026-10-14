"use client";
import { Toast } from "radix-ui";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
export type BoardNotice = {
  id: string;
  message: string;
  kind: "success" | "error";
};
export function OperationToast({ notice }: { notice: BoardNotice | null }) {
  return (
    <Toast.Provider duration={5000} swipeDirection="right">
      {notice && (
        <Toast.Root
          key={notice.id}
          defaultOpen
          data-slot="board-notification"
          className="flex items-start gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-lg"
          type={notice.kind === "error" ? "foreground" : "background"}
        >
          {notice.kind === "error" ? (
            <CircleAlert className="size-5 shrink-0 text-destructive" />
          ) : (
            <CheckCircle2 className="size-5 shrink-0 text-primary" />
          )}
          <Toast.Title className="flex-1 text-sm">{notice.message}</Toast.Title>
          <Toast.Close
            aria-label="Dismiss notification"
            className="rounded-sm p-1 text-muted-foreground hover:bg-accent"
          >
            <X size={14} />
          </Toast.Close>
        </Toast.Root>
      )}
      <Toast.Viewport className="fixed right-4 bottom-4 z-[100] m-0 flex max-w-[calc(100vw-32px)] w-96 list-none flex-col gap-2 p-0 outline-none" />
    </Toast.Provider>
  );
}
