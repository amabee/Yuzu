import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  icons: { icon: "/logo.svg" },
  title: { default: "Yuzu — Your team's workspace", template: "%s · Yuzu" },
  description:
    "Organize your team's work, shape your boards, and keep decisions together.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
