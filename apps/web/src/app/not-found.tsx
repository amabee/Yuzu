import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="py-16">
      <p className="text-sm text-muted-foreground">Page not found</p>
      <h1 className="mt-3 text-3xl font-semibold">
        Let&apos;s get you back to your workspace.
      </h1>
      <Button asChild className="mt-6">
        <Link href="/">Go to overview</Link>
      </Button>
    </div>
  );
}
