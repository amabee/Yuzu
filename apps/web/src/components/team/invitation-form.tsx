"use client";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import {
  invitationPreviewSchema,
  invitationAcceptedSchema,
} from "@/lib/team-contract";
import { Field, Input } from "@/components/setup/field";
import { ModeSwitcher } from "@/components/appearance/theme-runtime";
import { Button } from "@/components/ui/button";
import { SignInForm } from "@/components/setup/sign-in-form";
import { useUiStore } from "@/components/providers";

const subscribe = (callback: () => void) => {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
};
export function InvitationForm() {
  const token = useSyncExternalStore(
    subscribe,
    () => window.location.hash.slice(1),
    () => "",
  );
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
  const client = useQueryClient();
  const resetUi = useUiStore((state) => state.reset);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const preview = useQuery({
    queryKey: ["invitation", token],
    enabled: valid,
    retry: false,
    queryFn: async () =>
      invitationPreviewSchema.parse(
        (
          await apiRequest("/api/v1/team/preview", {
            method: "POST",
            json: { token },
          })
        ).data,
      ),
  });
  const accept = useMutation({
    mutationFn: async () =>
      invitationAcceptedSchema.parse(
        (
          await apiRequest("/api/v1/team/accept", {
            method: "POST",
            json: preview.data?.existingAccount
              ? { token }
              : { token, name, password },
          })
        ).data,
      ),
    onSuccess: () => {
      setPassword("");
      setConfirmation("");
      client.removeQueries({ queryKey: ["invitation"] });
      window.history.replaceState(null, "", "/invite");
    },
  });
  const signOut = useMutation({
    mutationFn: () =>
      apiRequest("/api/v1/session/sign-out", { method: "POST", json: {} }),
    onSuccess: () => {
      client.clear();
      resetUi();
      window.location.reload();
    },
  });
  if (accept.isSuccess)
    return (
      <main className="mx-auto max-w-lg px-6 py-20">
        <h1 className="text-3xl font-semibold">You’re part of the team.</h1>
        <p className="mt-4">Your workspace membership is ready.</p>
        <Button asChild className="mt-6">
          <Link href={accept.data?.signedIn ? "/" : "/sign-in"}>
            {accept.data?.signedIn ? "Open workspace" : "Sign in to Yuzu"}
          </Link>
        </Button>
      </main>
    );
  if (!valid || preview.error)
    return (
      <main className="mx-auto max-w-lg px-6 py-20">
        <h1 className="text-2xl font-semibold">Invitation unavailable</h1>
        <p role="alert" className="mt-4">
          {preview.error?.message ??
            "Open the complete invitation link from your email, or ask your administrator for a new one."}
        </p>
      </main>
    );
  if (!preview.data)
    return (
      <main className="p-10" role="status">
        Checking invitation…
      </main>
    );
  const invitation = preview.data;
  if (invitation.signedInAsOther)
    return (
      <main className="mx-auto max-w-lg px-6 py-20">
        <h1 className="text-2xl font-semibold">
          This invitation is for another account.
        </h1>
        <p className="mt-4">
          Sign out first, then continue as {invitation.email}.
        </p>
        {signOut.error && <p role="alert">{signOut.error.message}</p>}
        <Button
          className="mt-6"
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
        >
          Sign out and continue
        </Button>
      </main>
    );
  if (invitation.existingAccount && !invitation.signedInAsRecipient)
    return (
      <div>
        <p className="px-6 pt-8 text-center">
          Sign in as {invitation.email} to join {invitation.workspaceName}.
        </p>
        <SignInForm
          returnTo={`/invite#${token}`}
          onSignedIn={() => window.location.reload()}
        />
      </div>
    );
  return (
    <main className="yuzu-account relative flex min-h-svh items-center justify-center px-5 py-10">
      <div className="absolute top-5 right-5">
        <ModeSwitcher />
      </div>
      <div className="w-full max-w-lg rounded-2xl border bg-card p-8">
        <h1 className="text-3xl font-semibold">
          Join {invitation.workspaceName}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Invited as {invitation.email}. You’ll join as a workspace member.
        </p>
        <form
          className="mt-7 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!invitation.existingAccount && password !== confirmation)
              return;
            accept.mutate();
          }}
        >
          {!invitation.existingAccount && (
            <>
              <Field id="name" label="Your name">
                <Input
                  id="name"
                  required
                  maxLength={100}
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field id="password" label="Password">
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
              <Field id="confirm-password" label="Confirm password">
                <Input
                  id="confirm-password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </Field>
              {confirmation && password !== confirmation && (
                <p role="alert" className="text-sm text-destructive">
                  Passwords must match.
                </p>
              )}
            </>
          )}
          {accept.error && (
            <p role="alert" className="text-sm text-destructive">
              {accept.error.message}
            </p>
          )}
          <Button
            type="submit"
            disabled={
              accept.isPending ||
              (!invitation.existingAccount && password !== confirmation)
            }
          >
            {accept.isPending ? "Joining…" : "Accept invitation"}
          </Button>
        </form>
      </div>
    </main>
  );
}
