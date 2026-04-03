"use client";

import { useState } from "react";

export default function LogoutButton() {
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    await fetch("/auth/sign-out", { method: "POST" });
    setLoading(false);
    window.location.assign("/login");
  };

  return (
    <button className="btn btn-ghost" onClick={handleLogout} disabled={loading}>
      {loading ? "Kilépés..." : "Kilépés"}
    </button>
  );
}
