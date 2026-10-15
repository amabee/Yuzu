"use client";
import { ModeSwitcher } from "@/components/appearance/theme-runtime";
import Image from "next/image";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "nextjs-toploader/app";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";
import { useUiStore } from "@/components/providers";
import { Field, Input } from "./field";

export function SignInForm({
  returnTo = "/",
  onSignedIn,
}: {
  returnTo?: string;
  onSignedIn?: () => void;
}) {
  const form = useForm<{ email: string; password: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const reset = useUiStore((state) => state.reset);
  const mutation = useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      apiRequest("/api/v1/session/sign-in", { method: "POST", json: input }),
    onSuccess: async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
      reset();
      form.reset();
      router.replace(returnTo);
      router.refresh();
      onSignedIn?.();
    },
  });
  return (
    <main className="yuzu-account relative flex min-h-svh items-center justify-center px-5 py-10">
      <div className="absolute top-5 right-5">
        <ModeSwitcher />
      </div>
      <div className="w-full max-w-md rounded-2xl border bg-card p-7 sm:p-9">
        <Image src="/logo.svg" alt="Yuzu" width={44} height={44} />
        <h1 className="mt-6 text-2xl font-semibold">Welcome back.</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Sign in to continue to your workspace or accept an invitation.
        </p>
        <form
          className="mt-7 space-y-5"
          onSubmit={form.handleSubmit((input) => mutation.mutate(input))}
        >
          <Field label="Email address" id="email">
            <Input
              id="email"
              type="email"
              required
              autoComplete="username"
              {...form.register("email")}
            />
          </Field>
          <Field label="Password" id="password">
            <Input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              {...form.register("password")}
            />
          </Field>
          <Link
            href="/forgot-password"
            className="inline-block text-sm text-primary underline underline-offset-4"
          >
            Forgot password?
          </Link>
          {mutation.error && (
            <p role="alert" className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          )}
          <Button
            type="submit"
            disabled={mutation.isPending}
            className="w-full"
          >
            {mutation.isPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}
