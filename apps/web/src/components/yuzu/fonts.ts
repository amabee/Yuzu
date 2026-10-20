import { Bricolage_Grotesque, Figtree } from "next/font/google";

// Add `${display.variable} ${body.variable}` to <body className> in app/layout.tsx.
export const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "800"],
  variable: "--font-display",
});
export const body = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});
