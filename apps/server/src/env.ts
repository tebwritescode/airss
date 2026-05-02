import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().default(8787),
  DB_PATH: z.string().default("./data/swift-newt.sqlite"),
  MASTER_KEY: z.string().min(32, "MASTER_KEY must be >=32 bytes (base64 of 32 random bytes)"),
  SESSION_SECRET: z.string().min(32),
  USER_PASSWORD_HASH: z.string().optional(),
  PUBLIC_ORIGIN: z.string().default("http://localhost:8787"),
  PWA_DIST: z.string().default("../pwa/build"),
});

export const env = Env.parse(process.env);
export type Env = z.infer<typeof Env>;
