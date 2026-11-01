export type SnapshotOrigin = "dev" | "live";

/** A live forward-test row requires both VERCEL_ENV=production and FORWARD_TEST_ENABLED=true. */
export function snapshotOrigin(environment: { vercelEnv?: string; forwardTestEnabled?: string }): SnapshotOrigin {
  return environment.vercelEnv === "production" && environment.forwardTestEnabled === "true" ? "live" : "dev";
}

