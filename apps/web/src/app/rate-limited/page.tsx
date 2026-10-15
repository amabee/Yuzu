"use client";
import { useRouter } from "nextjs-toploader/app";
import { RateLimitedScreen } from "@/components/yuzu/service-screens";
export default function RateLimited() {
  const router = useRouter();
  return <RateLimitedScreen onRetry={() => router.replace("/")} />;
}
