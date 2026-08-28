import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Bypasses RLS with the service_role key — for trusted server-only jobs
 * that have no logged-in user to scope a session to (cron, scheduled
 * seeding). Never use this to handle a request on a learner's behalf; use
 * server.ts's cookie-scoped client there so RLS still applies.
 */
export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
