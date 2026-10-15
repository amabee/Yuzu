"use client";
import { createRecordId } from "@yuzu/database/ids";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bookmark, Save, Users, Trash2, RotateCcw } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import {
  defaultViewConfig,
  type SavedView,
  type ViewConfig,
} from "@/lib/saved-view-contract";
import { stableJson } from "@/lib/approval-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

type Editor = {
  id: string;
  name: string;
  visibility: "PERSONAL" | "SHARED";
  revision: number;
  remove?: boolean;
};
export function SavedViewControls({
  views,
  active,
  config,
  userId,
  canManage,
  boardId,
  onApply,
  onRefresh,
  notify,
}: {
  views: SavedView[];
  active: SavedView | null;
  config: ViewConfig;
  userId: string;
  canManage: boolean;
  boardId: string;
  onApply: (view: SavedView | null, config: ViewConfig) => void;
  onRefresh: () => Promise<unknown>;
  notify: (message: string, kind: "success" | "error") => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const latest = views.find((view) => view.id === active?.id);
  const canEdit =
    active &&
    (active.visibility === "SHARED" ? canManage : active.ownerId === userId) &&
    !!latest;
  const changed = active && stableJson(active.config) !== stableJson(config);
  const stale = active && (!latest || latest.revision !== active.revision);
  const mutation = useMutation({
    mutationFn: async (input: {
      action: string;
      data: unknown;
      next?: SavedView | null;
      nextConfig?: ViewConfig;
    }) => {
      await apiRequest(`/api/v1/boards/${input.action}`, {
        method: "POST",
        json: input.data,
      });
      return input;
    },
    onSuccess: async (input) => {
      if (input.action === "select-view")
        onApply(input.next ?? null, input.nextConfig ?? defaultViewConfig);
      else if (input.action === "save-view" && editor) {
        onApply(
          {
            id: editor.id,
            name: editor.name.trim(),
            visibility: editor.visibility,
            revision: editor.revision + 1,
            config,
            ownerId: editor.revision ? (latest?.ownerId ?? userId) : userId,
          },
          config,
        );
        setEditor(null);
      } else if (input.action === "remove-view") {
        onApply(null, defaultViewConfig);
        setEditor(null);
      }
      await onRefresh();
      if (input.action !== "select-view")
        notify(
          input.action === "save-view" ? "View saved" : "View removed",
          "success",
        );
    },
    onError: async (error) => {
      notify(error.message, "error");
      await onRefresh();
    },
  });
  const choose = (id: string) => {
    const next = views.find((view) => view.id === id) ?? null;
    mutation.mutate({
      action: "select-view",
      data: { boardId, viewId: next?.id ?? null },
      next,
      nextConfig: next?.config ?? defaultViewConfig,
    });
  };
  return (
    <>
      <div
        className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2"
        aria-label="Saved views"
      >
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:max-w-64 sm:flex-1">
          <Bookmark
            size={15}
            className="shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <select
            aria-label="Saved board view"
            className="task-select min-w-0 max-w-full sm:max-w-64"
            disabled={mutation.isPending}
            value={latest ? (active?.id ?? "") : ""}
            onChange={(event) => choose(event.target.value)}
          >
            <option value="">Default view</option>
            <optgroup label="Personal views">
              {views
                .filter((view) => view.visibility === "PERSONAL")
                .map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Shared with team">
              {views
                .filter((view) => view.visibility === "SHARED")
                .map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
            </optgroup>
          </select>
        </div>
        {active?.visibility === "SHARED" && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Users size={12} />
            Shared
          </span>
        )}
        {changed && (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
        <div className="flex flex-wrap items-center gap-1 sm:ml-auto">
          <Button
            variant="ghost"
            size="sm"
            disabled={mutation.isPending}
            onClick={() =>
              onApply(latest ?? null, latest?.config ?? defaultViewConfig)
            }
          >
            <RotateCcw size={13} />
            Reset filters
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={mutation.isPending}
            onClick={() => {
              mutation.reset();
              setEditor({
                id: createRecordId(),
                name: "",
                visibility: "PERSONAL",
                revision: 0,
              });
            }}
          >
            <Save size={13} />
            Save view
          </Button>
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => {
                mutation.reset();
                setEditor({
                  id: active.id,
                  name: active.name,
                  visibility: active.visibility,
                  revision: active.revision,
                });
              }}
            >
              Manage view
            </Button>
          )}
        </div>
        {stale && (
          <p role="status" className="w-full text-xs text-muted-foreground">
            This view changed or was removed.{" "}
            <button
              className="text-primary underline"
              disabled={mutation.isPending}
              onClick={() => choose(latest?.id ?? "")}
            >
              Reload saved view
            </button>
          </p>
        )}
      </div>
      <Sheet
        open={!!editor}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setEditor(null);
        }}
      >
        <SheetContent className="p-6">
          <SheetTitle>
            {editor?.remove
              ? "Remove saved view?"
              : editor?.revision
                ? "Manage saved view"
                : "Save this view"}
          </SheetTitle>
          <SheetDescription>
            {editor?.remove
              ? "Tasks and board data will stay unchanged. Anyone using this shared view will return to the default view on their next visit."
              : "Keep this layout, search, filters, and sorting ready for next time."}
          </SheetDescription>
          {editor &&
            (editor.remove ? (
              <div className="space-y-4">
                <p className="text-sm">Remove “{editor.name}”?</p>
                <Button
                  variant="destructive"
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate({
                      action: "remove-view",
                      data: {
                        boardId,
                        id: editor.id,
                        revision: editor.revision,
                      },
                    })
                  }
                >
                  Confirm remove view
                </Button>
                <Button
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() => setEditor({ ...editor, remove: false })}
                >
                  Keep view
                </Button>
              </div>
            ) : (
              <form
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  mutation.mutate({
                    action: "save-view",
                    data: {
                      boardId,
                      id: editor.id,
                      name: editor.name,
                      revision: editor.revision,
                      visibility: editor.visibility,
                      config,
                    },
                  });
                }}
              >
                <label className="grid gap-2 text-sm">
                  View name
                  <Input
                    value={editor.name}
                    maxLength={80}
                    required
                    disabled={mutation.isPending}
                    onChange={(event) =>
                      setEditor({ ...editor, name: event.target.value })
                    }
                    placeholder="e.g. My upcoming tasks"
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  Who can see it
                  <select
                    aria-label="View visibility"
                    className="task-select"
                    value={editor.visibility}
                    disabled={!!editor.revision || mutation.isPending}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        visibility: event.target.value as Editor["visibility"],
                      })
                    }
                  >
                    <option value="PERSONAL">Only me</option>
                    {canManage && (
                      <option value="SHARED">Everyone on this board</option>
                    )}
                  </select>
                </label>
                <p className="text-xs text-muted-foreground">
                  {editor.visibility === "SHARED"
                    ? "Board managers can update this view. Each teammate keeps their own selected view."
                    : "Your personal views are private, including from other board managers."}
                </p>
                <Button
                  disabled={mutation.isPending || !editor.name.trim()}
                  type="submit"
                >
                  {mutation.isPending
                    ? "Saving…"
                    : editor.revision
                      ? "Update view"
                      : "Save new view"}
                </Button>
                {!!editor.revision && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={mutation.isPending}
                    onClick={() => setEditor({ ...editor, remove: true })}
                  >
                    <Trash2 size={14} />
                    Remove view
                  </Button>
                )}
              </form>
            ))}
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
