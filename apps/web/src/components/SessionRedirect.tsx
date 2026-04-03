"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SessionRedirect() {
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        window.location.replace("/dashboard");
      }
    });
  }, []);

  return null;
}
