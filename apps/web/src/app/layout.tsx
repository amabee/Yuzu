import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";
import { cookies } from "next/headers";
import type { CSSProperties } from "react";
import { publishedAppearance } from "@/server/appearance-service";
import { themeVariables, type Mode } from "@/lib/appearance";
import { themeFonts } from "@/lib/theme-fonts";

export const metadata: Metadata = {
  icons: { icon: "/logo.svg" },
  title: { default: "Yuzu — Your team's workspace", template: "%s · Yuzu" },
  description:
    "Organize your team's work, shape your boards, and keep decisions together.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [appearance, cookieStore] = await Promise.all([
    publishedAppearance(),
    cookies(),
  ]);
  const preference = cookieStore.get("yuzu-mode")?.value;
  const mode: Mode =
    preference === "light" || preference === "dark" ? preference : "system";
  const initialMode = mode === "dark" ? "dark" : "light";
  // Validated theme values contain only safe colors, font enums, and numeric controls.
  const variants = JSON.stringify({
    light: themeVariables(appearance.theme, "light"),
    dark: themeVariables(appearance.theme, "dark"),
  }).replace(/</g, "\\u003c");
  const bootstrap = `(()=>{const m=${JSON.stringify(mode)};const r=m==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):m;const v=${variants};for(const [k,s]of Object.entries(v[r]))document.documentElement.style.setProperty(k,s);document.documentElement.dataset.mode=r;document.documentElement.classList.toggle('dark',r==='dark');document.documentElement.style.colorScheme=r;})()`;
  return (
    <html
      lang="en"
      className={`${themeFonts}${initialMode === "dark" ? " dark" : ""}`}
      style={themeVariables(appearance.theme, initialMode) as CSSProperties}
      data-mode={initialMode}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootstrap }} />
      </head>
      <body>
        <Providers appearance={appearance} mode={mode}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
