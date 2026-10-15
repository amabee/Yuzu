"use client";
import { YuzuToast, type YuzuToastNotice } from "@/components/ui/yuzu-toast";
export type BoardNotice = YuzuToastNotice;
export function OperationToast({
  notice,
  pinnedNotices,
}: {
  notice: BoardNotice | null;
  pinnedNotices?: BoardNotice[];
}) {
  return <YuzuToast notice={notice} pinnedNotices={pinnedNotices} />;
}
