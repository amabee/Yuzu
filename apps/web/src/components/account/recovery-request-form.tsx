"use client";
import { ModeSwitcher } from "@/components/appearance/theme-runtime";
import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { recoveryResultSchema } from "@/lib/recovery-contract";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/setup/field";

export function RecoveryRequestForm() {
  const [email, setEmail] = useState("");
  const mutation = useMutation({
    mutationFn: async () =>
      recoveryResultSchema.parse(
        (
          await apiRequest("/api/v1/recovery/request", {
            method: "POST",
            json: { email },
          })
        ).data,
      ),
  });
  return (
    <main className="yuzu-account relative flex min-h-svh items-center justify-center px-5 py-10">
      <div className="absolute top-5 right-5">
        <ModeSwitcher />
      </div>
      <div className="w-full max-w-md rounded-2xl border bg-card p-8">
        <h1 className="text-2xl font-semibold">Forgot your password?</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Enter the email address you use for Yuzu.
        </p>
        <form
          className="mt-7 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field id="recovery-email" label="Email address">
            <Input
              id="recovery-email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                mutation.reset();
              }}
            />
          </Field>
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
          {mutation.isSuccess && (
            <p role="status" className="text-sm">
              If an account exists for this email and delivery is available,
              you’ll receive a recovery link. Check your inbox and spam folder.
              Links expire after 30 minutes. Wait one minute before requesting
              another.
            </p>
          )}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Requesting…" : "Send recovery link"}
          </Button>
        </form>
        <Link
          href="/sign-in"
          className="mt-6 inline-block text-sm text-primary underline underline-offset-4"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
