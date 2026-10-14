"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { Sun, Moon, Monitor } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
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
const ModeContext = createContext<{
  store: ReturnType<typeof preferenceStore>;
  busy: boolean;
  changeMode: (mode: Mode, element: HTMLElement) => void;
} | null>(null);
function resolvedMode(mode: Mode) {
  return mode === "system"
    ? matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : mode;
}
function applyAppearance(appearance: PublishedTheme, mode: Mode) {
  const resolved = resolvedMode(mode);
  const html = document.documentElement;
  for (const [key, value] of Object.entries(
    themeVariables(appearance.theme, resolved),
  ))
    html.style.setProperty(key, value);
  html.dataset.mode = resolved;
  html.classList.toggle("dark", resolved === "dark");
  html.style.colorScheme = resolved;
}
function subscribeDark(callback: () => void) {
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

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
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
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
    const apply = () => applyAppearance(published.data, mode);
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
  function changeMode(next: Mode, element: HTMLElement) {
    if (running.current) return;
    const change = () => {
      flushSync(() => store.getState().setMode(next));
      applyAppearance(published.data, next);
    };
    if (
      !document.startViewTransition ||
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      resolvedMode(next) === document.documentElement.dataset.mode
    ) {
      change();
      return;
    }
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(
      Math.max(x, innerWidth - x),
      Math.max(y, innerHeight - y),
    );
    running.current = true;
    setBusy(true);
    document.documentElement.classList.add("theme-ripple");
    const transition = document.startViewTransition(change);
    void transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${radius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 520,
            easing: "cubic-bezier(.22,1,.36,1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        /* A skipped transition still applies the preference. */
      });
    void transition.finished
      .catch(() => {})
      .finally(() => {
        running.current = false;
        setBusy(false);
        document.documentElement.classList.remove("theme-ripple");
      });
  }
  return (
    <ModeContext.Provider value={{ store, busy, changeMode }}>
      {children}
    </ModeContext.Provider>
  );
}
export function ModeSwitcher() {
  const context = useContext(ModeContext);
  if (!context) throw new Error("Theme preferences require ThemeRuntime.");
  const mode = useStore(context.store, (state) => state.mode);
  const systemDark = useSyncExternalStore(
    subscribeDark,
    () => matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
  const dark = mode === "dark" || (mode === "system" && systemDark);
  const switchRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="theme-picker" role="group" aria-label="Color mode">
      <div className="theme-picker-track">
        <Sun
          size={14}
          aria-hidden="true"
          className={!dark ? "text-primary" : "text-muted-foreground"}
        />
        <Switch
          ref={switchRef}
          checked={dark}
          aria-disabled={context.busy}
          aria-label="Dark mode"
          className="theme-mode-switch"
          onCheckedChange={(checked) => {
            if (switchRef.current)
              context.changeMode(checked ? "dark" : "light", switchRef.current);
          }}
        />
        <Moon
          size={14}
          aria-hidden="true"
          className={dark ? "text-primary" : "text-muted-foreground"}
        />
      </div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="theme-system-button"
        aria-label="Follow system theme"
        aria-pressed={mode === "system"}
        aria-disabled={context.busy}
        title={
          mode === "system" ? "Following system theme" : "Follow system theme"
        }
        onClick={(event) =>
          context.changeMode(
            mode === "system" ? (dark ? "dark" : "light") : "system",
            event.currentTarget,
          )
        }
      >
        <Monitor size={14} />
      </Button>
    </div>
  );
}
