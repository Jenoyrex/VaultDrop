import type { Metadata } from "next";
import { headers } from "next/headers";
import { AppProviders } from "@/components/providers/app-providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "VaultDrop",
  description: "Your Files. Your Password. Your Vault."
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading `headers()` forces this layout — and therefore every page
  // under it — to render dynamically per-request instead of being
  // statically optimized at build time. This is required for the
  // nonce-based CSP set in middleware.ts to work at all: a fresh nonce is
  // generated on every request, but a statically-cached page's inline
  // hydration script carries whatever nonce happened to be baked in at
  // build time, which mismatches every later request's freshly-generated
  // CSP header and breaks hydration entirely. This is Next.js's own
  // documented interaction between per-request CSP nonces and static
  // rendering — confirmed here by reproducing the failure (a hydration
  // error on the two previously-static routes, `/` and `/auth`) before
  // adding this line, not assumed in advance.
  //
  // `headers()` became an async Dynamic API in Next.js 15 (returns a
  // Promise instead of the value directly) — this `await` is required for
  // that reason, not a stylistic change; the return value is still
  // discarded, only its side effect (opting this layout into dynamic
  // rendering) is wanted.
  await headers();

  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
