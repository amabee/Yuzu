import type { LucideIcon } from "lucide-react";

export function EmptyFeature({
  title,
  intro,
  icon: Icon,
  heading,
  description,
  children,
}: {
  title: string;
  intro: string;
  icon: LucideIcon;
  heading: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold tracking-[0.15em] text-brand-secondary uppercase">
        Your workspace
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
        {intro}
      </p>
      <section className="mt-8 flex min-h-80 flex-col items-center justify-center rounded-2xl border bg-card p-8 text-center">
        <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-secondary">
          <Icon size={29} strokeWidth={1.5} className="text-primary" />
        </div>
        <h2 className="text-lg font-semibold">{heading}</h2>
        <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {children}
      </section>
    </div>
  );
}
