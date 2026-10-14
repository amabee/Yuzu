"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { AppearancePreview } from "@/components/design-preview/appearance-preview";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";
import {
  editorStateSchema,
  type EditorState,
  type Theme,
} from "@/lib/appearance";

export function ThemeEditor({ initial }: { initial: EditorState }) {
  const [store] = useState(() =>
    createStore<{ theme: Theme; change: (theme: Theme) => void }>((set) => ({
      theme: initial.draft ?? initial.theme,
      change: (theme) => set({ theme }),
    })),
  );
  const { theme, change } = useStore(store);
  const [notice, setNotice] = useState("");
  const client = useQueryClient();
  const state = useQuery({
    queryKey: ["appearance", "editor"],
    initialData: initial,
    queryFn: async () =>
      editorStateSchema.parse(
        (await apiRequest("/api/v1/appearance/state")).data,
      ),
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const mutation = useMutation({
    mutationFn: async (action: string) =>
      editorStateSchema.parse(
        (
          await apiRequest(`/api/v1/appearance/${action}`, {
            method: "POST",
            json: {
              revision: state.data.revision,
              ...(["draft", "publish"].includes(action) ? { theme } : {}),
            },
          })
        ).data,
      ),
    onSuccess: (next, action) => {
      client.setQueryData(["appearance", "editor"], next);
      if (action !== "draft") {
        client.setQueryData(["appearance", "published"], {
          theme: next.theme,
          revision: next.revision,
        });
        change(next.theme);
      }
      setNotice(
        action === "draft"
          ? "Draft saved. Everyone’s published theme is unchanged."
          : `Theme published for everyone · revision ${next.revision}.`,
      );
    },
  });
  const run = (action: string) => {
    setNotice("");
    mutation.mutate(action);
  };
  const actions = (
    <>
      <p className="text-xs text-muted-foreground">
        Published: {state.data.theme.name} · revision {state.data.revision}
      </p>
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => run("draft")}
        >
          Save draft
        </Button>
        <Button
          disabled={mutation.isPending || !theme.name.trim()}
          onClick={() => run("publish")}
        >
          Publish globally
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={mutation.isPending || !state.data.hasPrevious}
          onClick={() => run("restore")}
        >
          Restore previous
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => run("reset")}
        >
          Publish default
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => change(state.data.theme)}
        >
          Discard changes
        </Button>
      </div>
      <small>
        Publishing updates everyone’s theme. Their light/dark preference stays
        their own.
      </small>
    </>
  );
  return (
    <AppearancePreview
      fontClass=""
      editor={{ theme, onChange: change, actions, busy: mutation.isPending }}
    />
  );
}
