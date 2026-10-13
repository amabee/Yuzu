"use client";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="py-16">
      <h1 className="text-2xl font-semibold">This page couldn&apos;t load.</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Try again to return to your workspace.
      </p>
      <Button onClick={reset} className="mt-6">
        Try again
      </Button>
    </div>
  );
}
