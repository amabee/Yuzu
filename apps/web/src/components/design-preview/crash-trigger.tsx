"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CrashTrigger() {
  const [shouldCrash, setShouldCrash] = useState(false);

  // Error boundaries catch render failures, rather than event-handler errors.
  if (shouldCrash) throw new Error("Yuzu development crash trigger");

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-xl border bg-card p-8 text-card-foreground shadow-sm">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Development only
        </p>
        <h1 className="mt-3 text-2xl">Test error recovery</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Trigger an intentional render error to open Yuzu’s actual error page.
          Choose Try again to return here. No data is changed.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Next.js may show its development error overlay first. Close that
          overlay to see Yuzu’s error page underneath.
        </p>
        <Button
          className="mt-6"
          variant="destructive"
          onClick={() => setShouldCrash(true)}
        >
          Trigger test crash
        </Button>
      </section>
    </main>
  );
}
