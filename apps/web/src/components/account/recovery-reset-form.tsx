"use client";
import { ModeSwitcher } from "@/components/appearance/theme-runtime";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/api-client";
import { recoveryResultSchema } from "@/lib/recovery-contract";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/setup/field";
import { useUiStore } from "@/components/providers";

const subscribe = (callback: () => void) => {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
};
export function RecoveryResetForm() {
  const token = useSyncExternalStore(
    subscribe,
    () => window.location.hash.slice(1),
    () => "",
  );
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const client = useQueryClient();
  const resetUi = useUiStore((state) => state.reset);
  const mutation = useMutation({
    mutationFn: async () =>
      recoveryResultSchema.parse(
        (
          await apiRequest("/api/v1/recovery/reset", {
            method: "POST",
            json: { token, password, confirmation },
          })
        ).data,
      ),
    onSuccess: async () => {
      await client.cancelQueries();
      client.removeQueries();
      resetUi();
      setPassword("");
      setConfirmation("");
      window.history.replaceState(null, "", "/reset-password");
    },
  });
  const unavailable =
    !valid ||
    (mutation.error instanceof ApiError && mutation.error.status === 410);
  return (
    <main className="yuzu-account relative flex min-h-svh items-center justify-center px-5 py-10">
      <div className="absolute top-5 right-5">
        <ModeSwitcher />
      </div>
      <div className="w-full max-w-md rounded-2xl border bg-card p-8">
        {mutation.isSuccess ? (
          <>
            <h1 className="text-2xl font-semibold">
              Your password is updated.
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              All sessions for your account have been signed out. Sign in with
              your new password.
            </p>
            <Button asChild className="mt-6">
              <Link href="/sign-in">Sign in to Yuzu</Link>
            </Button>
          </>
        ) : unavailable ? (
          <>
            <h1 className="text-2xl font-semibold">
              Recovery link unavailable
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {mutation.error?.message ??
                "Open the complete link from your recovery email, or request a new one."}
            </p>
            <Link
              href="/forgot-password"
              className="mt-6 inline-block text-sm text-primary underline underline-offset-4"
            >
              Request a new recovery link
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">Set a new password</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Use at least 12 characters. Updating your password signs you out
              of all sessions.
            </p>
            <form
              className="mt-7 space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                if (password === confirmation) mutation.mutate();
              }}
            >
              <Field id="password" label="New password">
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Field id="confirmation" label="Confirm password">
                <Input
                  id="confirmation"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </Field>
              {confirmation && confirmation !== password && (
                <p role="alert" className="text-sm text-destructive">
                  Passwords must match.
                </p>
              )}
              {mutation.error && (
                <p role="alert" className="text-sm text-destructive">
                  {mutation.error.message}
                </p>
              )}
              <Button
                type="submit"
                disabled={mutation.isPending || password !== confirmation}
              >
                {mutation.isPending ? "Updating…" : "Update password"}
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
