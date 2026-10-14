"use client";
import { YuzuToast, type YuzuToastNotice } from "@/components/ui/yuzu-toast";
export type BoardNotice = YuzuToastNotice;
export function OperationToast({ notice }: { notice: BoardNotice | null }) {
  return <YuzuToast notice={notice} />;
}
