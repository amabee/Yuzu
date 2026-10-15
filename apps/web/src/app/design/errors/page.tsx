import { notFound } from "next/navigation";
import { CrashTrigger } from "@/components/design-preview/crash-trigger";

export const metadata = {
  title: "Error recovery test",
  robots: { index: false, follow: false },
};

export default function ErrorTestPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return <CrashTrigger />;
}
