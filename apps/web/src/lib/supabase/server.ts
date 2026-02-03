import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

export function createServerSupabase() {
  const env = getSupabaseEnv();
  if (!env) {
    return null;
  }

  const cookieStore = cookies();

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options?: Parameters<typeof cookieStore.set>[0]) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // No-op in Server Components where cookies are readonly.
        }
      },
      remove(name: string, options?: Parameters<typeof cookieStore.set>[0]) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // No-op in Server Components where cookies are readonly.
        }
      }
    }
  });
}
