import { z } from "zod";
import {
  contrast,
  fontFamily,
  presets,
  previewThemeSchema,
  type PreviewTheme,
} from "@/components/design-preview/theme-model";

export { presets, previewThemeSchema };
export type Theme = PreviewTheme;
export type Mode = "light" | "dark" | "system";
export const publishedThemeSchema = z.object({
  theme: previewThemeSchema,
  revision: z.number().int().nonnegative(),
});
export const editorStateSchema = publishedThemeSchema.extend({
  draft: previewThemeSchema.nullable(),
  hasPrevious: z.boolean(),
});
export type PublishedTheme = z.infer<typeof publishedThemeSchema>;
export type EditorState = z.infer<typeof editorStateSchema>;
export function savedTheme(value: unknown): Theme {
  const result = previewThemeSchema.safeParse(value);
  return result.success ? result.data : presets[0];
}
export function themeVariables(
  theme: Theme,
  mode: "light" | "dark",
): Record<string, string> {
  const c = theme[mode];
  const onPrimary =
    contrast(c.primary, "#FFFFFF") > contrast(c.primary, "#101820")
      ? "#FFFFFF"
      : "#101820";
  return {
    "--destructive": mode === "dark" ? "#FDA4AF" : "#B42335",
    "--background": c.canvas,
    "--foreground": c.ink,
    "--card": c.paper,
    "--card-foreground": c.ink,
    "--popover": c.paper,
    "--popover-foreground": c.ink,
    "--primary": c.primary,
    "--primary-foreground": onPrimary,
    "--secondary": c.canvas,
    "--secondary-foreground": c.ink,
    "--muted": c.canvas,
    "--muted-foreground": c.muted,
    "--accent": c.canvas,
    "--accent-foreground": c.ink,
    "--border": c.border,
    "--input": c.border,
    "--ring": c.primary,
    "--sidebar": c.sidebar,
    "--sidebar-primary": c.primary,
    "--sidebar-primary-foreground": onPrimary,
    "--sidebar-accent": `color-mix(in srgb, ${c.sidebarInk} 12%, ${c.sidebar})`,
    "--sidebar-accent-foreground": c.sidebarInk,
    "--sidebar-border": `color-mix(in srgb, ${c.sidebarInk} 18%, ${c.sidebar})`,
    "--sidebar-ring": c.sidebarInk,
    "--sidebar-foreground": c.sidebarInk,
    "--brand-secondary": c.primary,
    "--brand-highlight": c.primary,
    "--brand-cream": c.canvas,
    "--radius": `${theme.radius}px`,
    "--theme-heading": fontFamily(theme.headingFont),
    "--theme-body": fontFamily(theme.bodyFont),
    "--theme-size": `${theme.fontSize}px`,
    "--theme-weight": `${theme.headingWeight}`,
    "--theme-tracking": `${theme.tracking}em`,
    "--theme-leading": `${theme.lineHeight}`,
    "--theme-blur": `${theme.blur}px`,
    "--theme-opacity": `${theme.glass}%`,
    "--theme-shadow":
      theme.shadow === 0
        ? "none"
        : `0 ${Math.max(1, theme.shadow / 3)}px ${theme.shadow * 2.5}px ${theme.shadow / 15}px rgba(0,0,0,${mode === "dark" ? 0.12 + theme.shadow / 75 : 0.04 + theme.shadow / 180})`,
    "--theme-card-shadow":
      theme.shadow === 0
        ? "none"
        : `0 ${Math.max(1, theme.shadow / 6)}px ${theme.shadow}px rgba(0,0,0,${mode === "dark" ? 0.1 + theme.shadow / 100 : 0.02 + theme.shadow / 250})`,
  };
}
