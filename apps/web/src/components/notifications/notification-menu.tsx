"use client";
import Link from "next/link";
import { useRouter } from "nextjs-toploader/app";
import { useState } from "react";
import { Popover } from "radix-ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AtSign, Bell, CheckCheck, UserRoundPlus, Zap } from "lucide-react";
import { z } from "zod";
import { apiRequest } from "@/lib/api-client";
import type { NotificationInbox } from "@/lib/notification-contract";

type Item = NotificationInbox["items"][number];

/**
 * The bell's dropdown: the latest notifications in place, without leaving
 * the page. The full list stays in the Inbox.
 */
export function NotificationMenu({
  principalId,
  count,
  data,
  loading,
  filter,
  onFilter,
}: {
  principalId: string;
  count: number;
  data?: NotificationInbox;
  loading: boolean;
  filter: "ALL" | "UNREAD";
  onFilter: (filter: "ALL" | "UNREAD") => void;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationKey: ["principal", principalId, "notifications"],
    mutationFn: async (
      input:
        | { action: "read-all"; throughId: string }
        | { action: "open"; id: string },
    ) =>
      z.object({ href: z.string().optional() }).parse(
        (
          await apiRequest("/api/v1/notifications/change", {
            method: "POST",
            json: input,
          })
        ).data,
      ),
    onSettled: () =>
      client.invalidateQueries({
        queryKey: ["principal", principalId, "notifications"],
      }),
    onSuccess: (result) => {
      if (!result.href) return;
      setOpen(false);
      router.push(result.href);
    },
  });
  const items = (data?.items ?? []).slice(0, 8);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="notification-bell"
          aria-label={`Notifications${count ? ` (${count} unread)` : ""}`}
        >
          <Bell size={18} aria-hidden="true" />
          {count > 0 && (
            <span className="notification-bell-count" aria-hidden="true">
              {count > 99 ? "99+" : count}
            </span>
          )}
          <span className="sr-only" aria-live="polite">
            {count} unread notifications
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="notification-menu"
          align="end"
          sideOffset={10}
          collisionPadding={12}
          aria-label="Notifications"
        >
          <header className="notification-menu-head">
            <h2>Notifications</h2>
            <button
              type="button"
              disabled={!count || !data?.items.length || mutation.isPending}
              onClick={() =>
                data?.items[0] &&
                mutation.mutate({
                  action: "read-all",
                  throughId: data.items[0].id,
                })
              }
            >
              Mark all as read
            </button>
          </header>
          <div
            className="notification-menu-tabs"
            role="radiogroup"
            aria-label="Show"
          >
            {(["ALL", "UNREAD"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={filter === value}
                onClick={() => onFilter(value)}
              >
                {value === "ALL" ? "All" : `Unread${count ? ` ${count}` : ""}`}
              </button>
            ))}
          </div>
          <ul className="notification-menu-list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  data-unread={!item.readAt || undefined}
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate({ action: "open", id: item.id })
                  }
                >
                  <KindIcon kind={item.kind} />
                  <span className="notification-menu-text">
                    <span>
                      <b>{item.actorName}</b> {item.message} <b>{item.name}</b>
                    </span>
                    <small>
                      {item.projectName ? `${item.projectName} / ` : ""}
                      {item.boardName} ·{" "}
                      <time dateTime={item.createdAt}>
                        {timeAgo(item.createdAt)}
                      </time>
                    </small>
                  </span>
                  {!item.readAt && (
                    <span
                      className="notification-menu-dot"
                      aria-label="Unread"
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
          {!items.length && (
            <p className="notification-menu-empty">
              {loading
                ? "Loading notifications…"
                : filter === "UNREAD"
                  ? "You're all caught up."
                  : "Assignments, mentions and approval updates will show up here."}
            </p>
          )}
          {mutation.error && (
            <p role="alert" className="notification-menu-error">
              {mutation.error.message}
            </p>
          )}
          <footer className="notification-menu-foot">
            <Link href="/notifications" onClick={() => setOpen(false)}>
              See all in Inbox
            </Link>
          </footer>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function KindIcon({ kind }: { kind: Item["kind"] }) {
  const Icon =
    kind === "MENTION"
      ? AtSign
      : kind === "ASSIGNMENT"
        ? UserRoundPlus
        : kind === "AUTOMATION"
          ? Zap
          : CheckCheck;
  return (
    <span
      className="notification-menu-icon"
      data-kind={kind}
      aria-hidden="true"
    >
      <Icon size={16} />
    </span>
  );
}

function timeAgo(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / 1440)}d ago`;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
