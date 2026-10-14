"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { apiRequest } from "@/lib/api-client";
import {
  publishedThemeSchema,
  themeVariables,
  type Mode,
  type PublishedTheme,
} from "@/lib/appearance";

type Preference = { mode: Mode; setMode: (mode: Mode) => void };
const ModeContext = createContext<ReturnType<typeof preferenceStore> | null>(
  null,
);
function preferenceStore(mode: Mode) {
  return createStore<Preference>((set) => ({
    mode,
    setMode: (mode) => {
      set({ mode });
      document.cookie = `yuzu-mode=${mode}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      try {
        localStorage.setItem("yuzu:mode", mode);
      } catch {
        /* Cookie still persists the preference. */
      }
    },
  }));
}
export function ThemeRuntime({
  initial,
  initialMode,
  children,
}: {
  initial: PublishedTheme;
  initialMode: Mode;
  children: React.ReactNode;
}) {
  const [store] = useState(() => preferenceStore(initialMode));
  const mode = useStore(store, (state) => state.mode);
  const published = useQuery({
    queryKey: ["appearance", "published"],
    queryFn: async () =>
      publishedThemeSchema.parse(
        (await apiRequest("/api/v1/appearance/published")).data,
      ),
    initialData: initial,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved =
        mode === "system" ? (media.matches ? "dark" : "light") : mode;
      const html = document.documentElement;
      for (const [key, value] of Object.entries(
        themeVariables(published.data.theme, resolved),
      ))
        html.style.setProperty(key, value);
      html.dataset.mode = resolved;
      html.classList.toggle("dark", resolved === "dark");
      html.style.colorScheme = resolved;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [mode, published.data]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (
        event.key === "yuzu:mode" &&
        ["light", "dark", "system"].includes(event.newValue ?? "")
      )
        store.getState().setMode(event.newValue as Mode);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [store]);
  return <ModeContext.Provider value={store}>{children}</ModeContext.Provider>;
}
export function ModeSwitcher() {
  const store = useContext(ModeContext);
  if (!store) throw new Error("Theme preferences require ThemeRuntime.");
  const { mode, setMode } = useStore(store);
  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span className="sr-only">Color mode</span>
      <select
        aria-label="Color mode"
        value={mode}
        onChange={(event) => setMode(event.target.value as Mode)}
        className="h-9 max-w-24 rounded-lg border bg-card px-2 text-foreground"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
