"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Bell,
  Check,
  CheckCheck,
  UserRoundPlus,
  ArrowUpRight,
  Inbox,
  Circle,
} from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { YuzuToast, type YuzuToastNotice } from "@/components/ui/yuzu-toast";
import {
  notificationInboxSchema,
  type NotificationInbox,
} from "@/lib/notification-contract";
import { apiRequest, ApiError } from "@/lib/api-client";
import { useApprovalLiveSync } from "@/components/boards/use-board-live-sync";

function useInbox(
  principalId: string,
  filter = "ALL",
  cursor?: string | null,
  initialData?: NotificationInbox,
  interval = 60_000,
) {
  return useQuery({
    queryKey: [
      "principal",
      principalId,
      "notifications",
      filter,
      cursor ?? null,
    ],
    initialData,
    staleTime: 0,
    queryFn: async ({ signal }) =>
      notificationInboxSchema.parse(
        (
          await apiRequest(
            `/api/v1/notifications/inbox?filter=${filter}${cursor ? `&cursor=${cursor}` : ""}`,
            { signal, cache: "no-store" },
          )
        ).data,
      ),
    refetchInterval: (query) =>
      query.state.error instanceof ApiError &&
      [401, 403].includes(query.state.error.status)
        ? false
        : interval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
}
export function NotificationBell({ principalId }: { principalId: string }) {
  const live = useApprovalLiveSync(principalId);
  const query = useInbox(
    principalId,
    "ALL",
    null,
    undefined,
    live.syncInterval,
  );
  const count = query.data?.unreadCount ?? 0;
  return (
    <Link
      href="/notifications"
      className="relative flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`Notifications${count ? ` (${count} unread)` : ""}`}
    >
      <Bell size={18} aria-hidden="true" />
      {count > 0 && (
        <span
          className="absolute -top-1 -right-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground"
          aria-hidden="true"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {count} unread notifications
      </span>
    </Link>
  );
}
export function NotificationInboxView({
  principalId,
  initialData,
  timezone,
}: {
  principalId: string;
  initialData: NotificationInbox;
  timezone: string;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const [filter, setFilter] = useState("ALL");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [notice, setNotice] = useState<YuzuToastNotice | null>(null);
  const cursor = cursors.at(-1);
  const query = useInbox(
    principalId,
    filter,
    cursor,
    filter === "ALL" && !cursor ? initialData : undefined,
  );
  const mutation = useMutation({
    mutationKey: ["principal", principalId, "notifications"],
    mutationFn: async (
      input:
        | { action: "read"; id: string; read: boolean }
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
    onSuccess: async (result, input) => {
      await client.invalidateQueries({
        queryKey: ["principal", principalId, "notifications"],
      });
      if (result.href) router.push(result.href);
      else
        setNotice({
          id: crypto.randomUUID(),
          kind: "success",
          title:
            input.action === "read-all"
              ? "Notifications marked as read"
              : input.action === "read" && !input.read
                ? "Marked as unread"
                : "Marked as read",
          message: "Your inbox is up to date.",
        });
    },
    onError: async (error) => {
      setNotice({
        id: crypto.randomUUID(),
        kind: "error",
        title: "Inbox could not update",
        message: error.message,
      });
      await client.invalidateQueries({
        queryKey: ["principal", principalId, "notifications"],
      });
    },
  });
  const items = query.data?.items ?? [];
  const formatter = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
  return (
    <section className="space-y-6" data-slot="notification-inbox">
      <YuzuToast notice={notice} />
      <div className="flex items-center gap-4">
        <span className="project-symbol">
          <Inbox size={26} />
        </span>
        <div>
          <h1 className="text-2xl sm:text-3xl">Your inbox</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Assignments and decisions, ready when you are.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Notification filter"
          className="flex gap-2"
        >
          {(["ALL", "UNREAD"] as const).map((value) => (
            <Button
              key={value}
              variant={filter === value ? "secondary" : "ghost"}
              aria-pressed={filter === value}
              disabled={mutation.isPending}
              onClick={() => {
                setFilter(value);
                setCursors([null]);
              }}
            >
              {value === "ALL"
                ? "All"
                : `Unread (${query.data?.unreadCount ?? 0})`}
            </Button>
          ))}
        </div>
        <Button
          variant="outline"
          disabled={
            mutation.isPending ||
            Boolean(cursor) ||
            !items.length ||
            !query.data?.unreadCount
          }
          onClick={() =>
            mutation.mutate({ action: "read-all", throughId: items[0]!.id })
          }
        >
          <CheckCheck size={15} />
          Mark all as read
        </Button>
      </div>
      {query.error && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 p-4"
        >
          <p className="text-sm">{query.error.message}</p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </div>
      )}
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading notifications…
        </p>
      )}
      {!query.isPending && !query.error && !items.length && (
        <div className="notification-surface flex min-h-64 flex-col items-center justify-center p-8 text-center">
          <Bell size={28} className="mb-4 text-primary" />
          <h2 className="text-lg">
            {filter === "UNREAD" ? "You're all caught up" : "Nothing here yet"}
          </h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            {filter === "UNREAD"
              ? "New assignments and approval updates will appear here."
              : "Your teammates' assignments and approval updates will appear here, even when you're offline."}
          </p>
        </div>
      )}
      {items.length > 0 && (
        <ul className="notification-surface divide-y divide-border overflow-hidden">
          {items.map((item) => {
            const Icon =
              item.kind === "ASSIGNMENT" ? UserRoundPlus : CheckCheck;
            return (
              <li
                key={item.id}
                data-notification-id={item.id}
                className={`flex items-start gap-3 p-4 sm:p-5 ${!item.readAt ? "bg-primary/5" : ""}`}
              >
                <span className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl border bg-background/50 text-primary">
                  <Icon size={17} />
                </span>
                <button
                  disabled={mutation.isPending}
                  className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() =>
                    mutation.mutate({ action: "open", id: item.id })
                  }
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-sm">
                      <b className="font-medium">{item.actorName}</b>{" "}
                      {item.message}
                    </span>
                    <ArrowUpRight
                      size={14}
                      className="mt-1 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="mt-1.5 block break-words text-sm font-semibold">
                    {item.name}
                  </span>
                  <span className="mt-1.5 block text-xs text-muted-foreground">
                    {item.boardName}
                  </span>
                  <time
                    dateTime={item.createdAt}
                    className="mt-2 block text-xs text-muted-foreground"
                  >
                    {formatter.format(new Date(item.createdAt))}
                  </time>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${item.readAt ? "Mark as unread" : "Mark as read"}: ${item.name}`}
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate({
                      action: "read",
                      id: item.id,
                      read: !item.readAt,
                    })
                  }
                >
                  {item.readAt ? (
                    <Check size={15} />
                  ) : (
                    <Circle size={10} className="fill-primary text-primary" />
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {(cursors.length > 1 || query.data?.nextCursor) && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={
              cursors.length === 1 || mutation.isPending || query.isFetching
            }
            onClick={() => setCursors((current) => current.slice(0, -1))}
          >
            Newer
          </Button>
          <Button
            variant="outline"
            disabled={
              !query.data?.nextCursor || mutation.isPending || query.isFetching
            }
            onClick={() =>
              setCursors((current) => [...current, query.data!.nextCursor])
            }
          >
            Older
          </Button>
        </div>
      )}
    </section>
  );
}
