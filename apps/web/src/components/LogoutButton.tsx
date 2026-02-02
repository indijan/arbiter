"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    await fetch("/auth/sign-out", { method: "POST" });
    setLoading(false);
    router.push("/login");
    router.refresh();
  };

  return (
    <button className="btn btn-ghost" onClick={handleLogout} disabled={loading}>
      {loading ? "Kilépés..." : "Kilépés"}
    </button>
  );
}
