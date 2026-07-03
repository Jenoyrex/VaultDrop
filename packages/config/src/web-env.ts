import { z } from "zod";

const webEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().min(1).default("http://localhost:4000")
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function loadWebEnv(source: Record<string, string | undefined>): WebEnv {
  const parsed = webEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid web environment configuration: ${issues}`);
  }
  return parsed.data;
}
