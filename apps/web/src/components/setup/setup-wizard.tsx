"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  Eye,
  EyeOff,
  Mail,
  Sprout,
} from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import {
  dateFormats,
  installationSchema,
  mailSchema,
  namesSchema,
  ownerSchema,
  ownerEmailSchema,
  verifySchema,
  type SetupStatus,
} from "@/lib/setup-contract";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClass } from "./field";

// Step numbers run 1–6; the introduction lives on its own page at /welcome.
const steps = [
  "Owner account",
  "Installation",
  "Email delivery",
  "Verify receipt",
  "Workspace & board",
  "Ready to work",
];
type Submit = (action: string, input: unknown, next: number) => Promise<void>;

export function SetupWizard({ initial }: { initial: SetupStatus }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(
    initial.authorized
      ? initial.settings?.emailVerified
        ? 5
        : initial.settings?.verificationPending
          ? 4
          : (initial.settings?.revision ?? 1) > 1
            ? 3
            : 2
      : 1,
  );
  const query = useQuery({
    queryKey: ["installation-setup"],
    queryFn: async () =>
      (await apiRequest<SetupStatus>("/api/v1/setup/status")).data,
    initialData: initial,
    refetchOnWindowFocus: false,
  });
  const status = query.data;
  const mutation = useMutation({
    mutationFn: async ({ action, input }: { action: string; input: unknown }) =>
      apiRequest(`/api/v1/setup/${action}`, { method: "POST", json: input }),
    onSettled: () => query.refetch(),
  });
  const submit: Submit = async (action, input, next) => {
    await mutation.mutateAsync({ action, input });
    setStep(next);
  };
  const blocked = status.phase !== "UNCLAIMED" && !status.authorized;
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const title = [
    "Make yourself at home.",
    "Give your workspace an identity.",
    "A reliable way to stay connected.",
    "Check your inbox.",
    "Make room for your first project.",
    "Your workspace is ready.",
  ][step - 1];
  return (
    <div className="min-h-svh bg-background lg:grid lg:grid-cols-[300px_1fr]">
      <aside className="flex flex-col bg-primary px-6 py-6 text-white lg:min-h-svh lg:px-8 lg:py-10">
        <Link href="/welcome" className="flex items-center gap-3">
          <Image src="/logo.svg" alt="Yuzu" width={38} height={38} priority />
          <span className="text-2xl font-semibold tracking-tight">
            yuzu<span className="text-brand-highlight">.</span>
          </span>
        </Link>
        <p className="mt-3 text-xs leading-5 text-white/75">
          A little structure.
          <br className="hidden lg:block" /> A lot of possibility.
        </p>
        <nav
          aria-label="Installation progress"
          className="mt-7 flex gap-2 overflow-x-auto lg:mt-12 lg:flex-col lg:gap-4"
        >
          {steps.map((label, i) => {
            const index = i + 1;
            return (
              <div
                key={label}
                aria-current={step === index ? "step" : undefined}
                className={`flex shrink-0 items-center gap-3 rounded-lg px-2 py-2 ${step === index ? "bg-white/12 text-white" : "text-white/65"}`}
              >
                <span
                  className={`flex size-7 items-center justify-center rounded-full border text-xs ${index < step ? "border-brand-highlight bg-brand-highlight text-primary" : "border-white/35"}`}
                >
                  {index < step ? <Check size={14} /> : index}
                </span>
                <span className="hidden text-sm sm:inline">{label}</span>
              </div>
            );
          })}
        </nav>
        <div className="mt-auto hidden pt-14 lg:block">
          <Sprout className="mb-4 text-brand-cream" />
          <p className="text-sm font-medium">Built around your work.</p>
          <p className="mt-2 text-xs leading-6 text-white/75">
            Independent hosting. Flexible boards. Clear decisions. A space your
            team can call its own.
          </p>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-10 sm:py-12 lg:px-16 lg:py-14">
        <div className="mb-8 flex items-center justify-between text-xs text-muted-foreground">
          <span>First installation</span>
          <span>
            Step {step} of {steps.length}
          </span>
        </div>
        <p className="mb-3 text-[11px] font-semibold tracking-[0.15em] text-brand-secondary uppercase">
          {steps[step - 1]}
        </p>
        <h1
          ref={heading}
          tabIndex={-1}
          className="max-w-2xl text-3xl leading-tight font-semibold tracking-tight outline-none sm:text-4xl"
        >
          {title}
        </h1>
        <div className="mt-7">
          {blocked ? (
            <div className="rounded-xl border bg-card p-6">
              <p className="text-sm leading-6">
                This installation has an owner. Sign in to continue the saved
                setup.
              </p>
              <Button asChild className="mt-5">
                <Link href="/sign-in">
                  Sign in to resume
                  <ArrowRight size={16} />
                </Link>
              </Button>
            </div>
          ) : (
            <>
              {mutation.error && (
                <div
                  role="alert"
                  className="mb-6 rounded-lg border border-destructive/20 bg-white px-4 py-3 text-sm text-destructive"
                >
                  {mutation.error.message}
                </div>
              )}
              {step === 1 && (
                <OwnerForm
                  submit={submit}
                  pending={mutation.isPending}
                  claimed={status.claimed}
                />
              )}
              {step === 2 && status.settings && (
                <InstallationForm
                  status={status}
                  submit={submit}
                  pending={mutation.isPending}
                />
              )}
              {step === 3 && status.settings && (
                <MailForm
                  status={status}
                  submit={submit}
                  pending={mutation.isPending}
                />
              )}
              {step === 4 && (
                <VerifyForm
                  status={status}
                  submit={submit}
                  pending={mutation.isPending}
                  onMail={() => setStep(3)}
                  onContinue={() => setStep(5)}
                />
              )}
              {step === 5 && status.settings && (
                <WorkspaceForm
                  status={status}
                  submit={submit}
                  pending={mutation.isPending}
                />
              )}
              {step === 6 && (
                <div className="rounded-2xl border bg-card p-7">
                  <div className="mb-5 flex size-14 items-center justify-center rounded-full bg-secondary">
                    <CheckCheck className="text-primary" size={27} />
                  </div>
                  <h2 className="text-xl font-semibold">
                    Welcome to {status.settings?.name}.
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    Your owner account, verified email delivery, workspace, and
                    first board are saved. No sample tasks have been added.
                  </p>
                  <dl className="mt-6 grid gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Workspace</dt>
                      <dd className="mt-1 font-medium">
                        {status.workspace?.name}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">First board</dt>
                      <dd className="mt-1 font-medium">{status.board?.name}</dd>
                    </div>
                  </dl>
                  <Button asChild className="mt-7">
                    <Link href={`/boards/${status.board?.id}`}>
                      Open your board
                      <ArrowRight size={16} />
                    </Link>
                  </Button>
                </div>
              )}
              {step <= 2 ? (
                // The owner step can't be revisited once claimed, so step back to the introduction.
                <Button asChild variant="ghost" className="mt-6">
                  <Link href="/welcome">
                    <ArrowLeft size={16} />
                    Back
                  </Link>
                </Button>
              ) : (
                step < 6 && (
                  <Button
                    variant="ghost"
                    className="mt-6"
                    disabled={mutation.isPending}
                    onClick={() => {
                      mutation.reset();
                      setStep(step - 1);
                    }}
                  >
                    <ArrowLeft size={16} />
                    Back
                  </Button>
                )
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function OwnerForm({
  submit,
  pending,
  claimed,
}: {
  submit: Submit;
  pending: boolean;
  claimed: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const form = useForm<z.infer<typeof ownerSchema>>({
    resolver: zodResolver(ownerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      setupKey: "",
    },
  });
  return (
    <form
      className="max-w-xl space-y-5"
      onSubmit={form.handleSubmit(async (data) => {
        try {
          await submit("owner", data, 2);
          form.reset();
        } catch {}
      })}
    >
      <p className="text-sm leading-6 text-muted-foreground">
        The owner manages this installation and its administrators.
        {claimed &&
          " Resume an interrupted claim with the original email and password."}
      </p>
      <Field
        label="Installation key"
        id="setupKey"
        hint="Copy YUZU_SETUP_KEY from the server's .env file. This prevents another visitor from claiming your installation."
        error={form.formState.errors.setupKey?.message}
      >
        <Input
          id="setupKey"
          type="password"
          autoComplete="off"
          {...form.register("setupKey")}
        />
      </Field>
      <Field
        label="Your name"
        id="name"
        error={form.formState.errors.name?.message}
      >
        <Input id="name" autoComplete="name" {...form.register("name")} />
      </Field>
      <Field
        label="Email address"
        id="email"
        error={form.formState.errors.email?.message}
      >
        <Input
          id="email"
          type="email"
          autoComplete="email"
          {...form.register("email")}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Password"
          id="password"
          hint="At least 12 characters."
          error={form.formState.errors.password?.message}
        >
          <div className="relative">
            <Input
              id="password"
              className="pr-11"
              type={visible ? "text" : "password"}
              autoComplete="new-password"
              {...form.register("password")}
            />
            <button
              type="button"
              aria-label={visible ? "Hide password" : "Show password"}
              onClick={() => setVisible(!visible)}
              className="absolute inset-y-0 right-3 text-muted-foreground"
            >
              {visible ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </Field>
        <Field
          label="Confirm password"
          id="confirmPassword"
          error={form.formState.errors.confirmPassword?.message}
        >
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            {...form.register("confirmPassword")}
          />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating owner…" : "Create owner account"}
        <ArrowRight size={16} />
      </Button>
    </form>
  );
}

function InstallationForm({
  status,
  submit,
  pending,
}: {
  status: SetupStatus;
  submit: Submit;
  pending: boolean;
}) {
  const form = useForm<z.infer<typeof installationSchema>>({
    resolver: zodResolver(installationSchema),
    defaultValues: {
      name: status.settings!.name,
      timezone: status.settings!.timezone,
      defaultDateFormat: status.settings!
        .defaultDateFormat as (typeof dateFormats)[number],
      revision: status.settings!.revision,
    },
  });
  useEffect(() => {
    if (status.settings!.revision === 1)
      form.setValue(
        "timezone",
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
  }, [form, status.settings]);
  const previewName = useWatch({ control: form.control, name: "name" });
  const previewTimezone = useWatch({ control: form.control, name: "timezone" });
  return (
    <form
      className="max-w-xl space-y-5"
      onSubmit={form.handleSubmit(async (data) => {
        try {
          await submit(
            "installation",
            { ...data, revision: status.settings!.revision },
            3,
          );
        } catch {}
      })}
    >
      <p className="text-sm leading-6 text-muted-foreground">
        Give this installation a recognizable name. Dates display using its
        timezone and format.
      </p>
      <Field
        label="Installation name"
        id="installationName"
        error={form.formState.errors.name?.message}
      >
        <Input id="installationName" {...form.register("name")} />
      </Field>
      <Field
        label="Timezone"
        id="timezone"
        error={form.formState.errors.timezone?.message}
      >
        <Input id="timezone" list="timezones" {...form.register("timezone")} />
        <datalist id="timezones">
          <option value="UTC" />
          {Intl.supportedValuesOf("timeZone").map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
      </Field>
      <Field label="Date format" id="dateFormat">
        <select
          id="dateFormat"
          className={inputClass}
          {...form.register("defaultDateFormat")}
        >
          {dateFormats.map((format, i) => (
            <option key={format} value={format}>
              {["13 Oct 2026", "2026-10-13", "13/10/2026", "10/13/2026"][i]}
            </option>
          ))}
        </select>
      </Field>
      <div className="rounded-xl bg-secondary p-4">
        <p className="text-xs text-muted-foreground">Installation preview</p>
        <p className="mt-2 text-lg font-semibold text-primary">
          {previewName || "Your installation"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{previewTimezone}</p>
      </div>
      <Button disabled={pending} type="submit">
        {pending ? "Saving…" : "Save and continue"}
        <ArrowRight size={16} />
      </Button>
    </form>
  );
}

function MailForm({
  status,
  submit,
  pending,
}: {
  status: SetupStatus;
  submit: Submit;
  pending: boolean;
}) {
  const form = useForm<z.infer<typeof mailSchema>>({
    resolver: zodResolver(mailSchema),
    defaultValues: {
      host: status.settings!.smtp?.host ?? "",
      port: status.settings!.smtp?.port ?? 587,
      secure: status.settings!.smtp?.secure ?? false,
      username: status.settings!.smtp?.username ?? "",
      password: "",
      fromEmail: status.settings!.smtp?.fromEmail ?? "",
      revision: status.settings!.revision,
    },
  });
  return (
    <form
      className="max-w-xl space-y-5"
      onSubmit={form.handleSubmit(async (data) => {
        try {
          await submit(
            "email",
            { ...data, revision: status.settings!.revision },
            4,
          );
          form.setValue("password", "");
        } catch {}
      })}
    >
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Mail size={17} className="text-primary" />
          Why email is required
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Invitations and password recovery need reliable delivery. We&apos;ll
          send a verification code to <strong>{status.owner?.email}</strong>.
          Setup can finish after you enter it.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-[1fr_110px]">
        <Field
          label="SMTP host"
          id="host"
          error={form.formState.errors.host?.message}
        >
          <Input
            id="host"
            placeholder="smtp.example.com"
            {...form.register("host")}
          />
        </Field>
        <Field
          label="Port"
          id="port"
          error={form.formState.errors.port?.message}
        >
          <Input
            id="port"
            type="number"
            {...form.register("port", { valueAsNumber: true })}
          />
        </Field>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          {...form.register("secure")}
          className="size-4 accent-primary"
        />
        Use implicit TLS (usually port 465)
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="SMTP username"
          id="username"
          hint="Leave empty only if your relay does not require authentication."
        >
          <Input
            id="username"
            autoComplete="off"
            {...form.register("username")}
          />
        </Field>
        <Field
          label="SMTP password"
          id="smtpPassword"
          hint={
            status.settings!.emailConfigured
              ? "Leave blank to retain saved credentials for the same connection."
              : undefined
          }
        >
          <Input
            id="smtpPassword"
            type="password"
            autoComplete="off"
            {...form.register("password")}
          />
        </Field>
      </div>
      <Field
        label="Sender email"
        id="fromEmail"
        error={form.formState.errors.fromEmail?.message}
      >
        <Input
          id="fromEmail"
          type="email"
          placeholder="yuzu@example.com"
          {...form.register("fromEmail")}
        />
      </Field>
      <Button disabled={pending} type="submit">
        {pending ? "Sending verification…" : "Send verification email"}
        <ArrowRight size={16} />
      </Button>
    </form>
  );
}

function VerifyForm({
  status,
  submit,
  pending,
  onMail,
  onContinue,
}: {
  status: SetupStatus;
  submit: Submit;
  pending: boolean;
  onMail: () => void;
  onContinue: () => void;
}) {
  const form = useForm<z.infer<typeof verifySchema>>({
    resolver: zodResolver(verifySchema),
    defaultValues: { code: "" },
  });
  const [correcting, setCorrecting] = useState(false);
  return (
    <div className="max-w-xl">
      <p className="mb-6 text-sm leading-6 text-muted-foreground">
        Enter the six-digit code sent to {status.owner?.email}. It expires in 10
        minutes. Your email credentials stay encrypted on the server.
      </p>
      {status.settings?.emailVerified ? (
        <div className="rounded-xl border bg-card p-6">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CheckCheck className="text-primary" size={18} />
            Email receipt is verified.
          </p>
          <Button className="mt-5" onClick={onContinue}>
            Continue
            <ArrowRight size={16} />
          </Button>
        </div>
      ) : (
        <form
          className="space-y-5"
          onSubmit={form.handleSubmit(async (data) => {
            try {
              await submit("verify", data, 5);
              form.reset();
            } catch {}
          })}
        >
          <Field
            label="Verification code"
            id="code"
            error={form.formState.errors.code?.message}
          >
            <Input
              id="code"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              className="max-w-64 text-lg tracking-[0.3em]"
              {...form.register("code")}
            />
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Verifying…" : "Verify and continue"}
            <ArrowRight size={16} />
          </Button>
        </form>
      )}
      <Button
        variant="ghost"
        className="mt-5"
        onClick={onMail}
        disabled={pending}
      >
        Change email settings or resend
      </Button>
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() => setCorrecting(!correcting)}
      >
        Wrong owner email address?
      </Button>
      {correcting && (
        <OwnerEmailForm status={status} submit={submit} pending={pending} />
      )}
    </div>
  );
}

function OwnerEmailForm({
  status,
  submit,
  pending,
}: {
  status: SetupStatus;
  submit: Submit;
  pending: boolean;
}) {
  const form = useForm<z.infer<typeof ownerEmailSchema>>({
    resolver: zodResolver(ownerEmailSchema),
    defaultValues: { email: status.owner?.email ?? "", password: "" },
  });
  return (
    <form
      className="mt-5 space-y-4 rounded-xl border bg-card p-5"
      onSubmit={form.handleSubmit(async (input) => {
        try {
          await submit("owner-email", input, 3);
          form.reset();
        } catch {}
      })}
    >
      <p className="text-sm leading-6 text-muted-foreground">
        Confirm your password to correct the owner address. The old code will
        stop working; send a new code to the corrected address.
      </p>
      <Field
        label="Correct owner email"
        id="correctOwnerEmail"
        error={form.formState.errors.email?.message}
      >
        <Input
          id="correctOwnerEmail"
          type="email"
          {...form.register("email")}
        />
      </Field>
      <Field
        label="Current owner password"
        id="currentOwnerPassword"
        error={form.formState.errors.password?.message}
      >
        <Input
          id="currentOwnerPassword"
          type="password"
          autoComplete="current-password"
          {...form.register("password")}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        Update owner email
      </Button>
    </form>
  );
}

function WorkspaceForm({
  status,
  submit,
  pending,
}: {
  status: SetupStatus;
  submit: Submit;
  pending: boolean;
}) {
  const form = useForm<z.infer<typeof namesSchema>>({
    resolver: zodResolver(namesSchema),
    defaultValues: {
      workspaceName: "Team workspace",
      boardName: "Project tasks",
      revision: status.settings!.revision,
    },
  });
  return (
    <form
      className="max-w-xl space-y-5"
      onSubmit={form.handleSubmit(async (data) => {
        try {
          await submit(
            "complete",
            { ...data, revision: status.settings!.revision },
            6,
          );
        } catch {}
      })}
    >
      <p className="text-sm leading-6 text-muted-foreground">
        A workspace brings your team&apos;s boards together. Your first project
        board starts empty, with direct editing as its default policy.
      </p>
      <Field
        label="Workspace name"
        id="workspaceName"
        error={form.formState.errors.workspaceName?.message}
      >
        <Input id="workspaceName" {...form.register("workspaceName")} />
      </Field>
      <Field
        label="First board name"
        id="boardName"
        error={form.formState.errors.boardName?.message}
      >
        <Input id="boardName" {...form.register("boardName")} />
      </Field>
      <div className="rounded-xl border bg-card p-5">
        <p className="text-xs font-medium text-primary">
          Project tasks template
        </p>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          Task · Status · Assignees · Priority · Due date · Description
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Status options: To do → In progress → Done
        </p>
      </div>
      <Button
        type="submit"
        disabled={pending || !status.settings?.emailVerified}
      >
        {pending ? "Creating your workspace…" : "Finish installation"}
        <Check size={16} />
      </Button>
      {!status.settings?.emailVerified && (
        <p role="alert" className="text-sm text-destructive">
          Verify email receipt before finishing.
        </p>
      )}
    </form>
  );
}
