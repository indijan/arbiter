"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefreshClient({ intervalSec = 45 }: { intervalSec?: number }) {
  const router = useRouter();
  const [last, setLast] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
      setLast(new Date());
    }, intervalSec * 1000);
    return () => clearInterval(id);
  }, [intervalSec, router]);

  return (
    <p className="text-xs" style={{ color: "var(--muted)" }}>
      Auto refresh: {intervalSec}s · last: {last.toLocaleTimeString("hu-HU")}
    </p>
  );
}
