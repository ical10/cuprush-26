import { z } from "zod";

export const appRuntimeModeSchema = z.enum(["full", "web"]).default("full");

export type AppRuntimeMode = z.infer<typeof appRuntimeModeSchema>;

export function parseAppRuntimeMode(
  value: unknown = process.env.APP_RUNTIME_MODE,
): AppRuntimeMode {
  return appRuntimeModeSchema.parse(value);
}
