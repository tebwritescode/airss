import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().default(8787),
  DB_PATH: z.string().default("./data/swift-newt.sqlite"),
  MASTER_KEY: z.string().min(32, "MASTER_KEY must be >=32 bytes (base64 of 32 random bytes)"),
  SESSION_SECRET: z.string().min(32),
  PUBLIC_ORIGIN: z.string().default("http://localhost:8787"),
  PWA_DIST: z.string().default("../pwa/build"),
  // Set to "1" to skip all authentication (useful when behind a trusted
  // reverse proxy that handles auth, or for single-user LAN deployments).
  AUTH_DISABLED: z.string().optional(),
});

export const env = Env.parse(process.env);
export type Env = z.infer<typeof Env>;
