import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";

const LOCAL_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: [
    {
      binding: "DB",
      database_name: "kline-training-local",
      database_id: LOCAL_DATABASE_ID,
    },
  ],
};

export default defineConfig(async ({ mode }) => {
  // Vite does not copy .env* values into process.env before loading this
  // config. Keep an explicit process value highest priority, then fall back
  // to the project-local environment file used by the launcher.
  const fileEnv = loadEnv(mode, process.cwd(), "");
  const configuredRemoteHost = process.env.KLINE_REMOTE_HOST?.trim()
    || fileEnv.KLINE_REMOTE_HOST?.trim();

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      // Listen on the IPv6 wildcard. Windows exposes this as a dual-stack
      // listener, so localhost/LAN IPv4 access remains available as well.
      // The companion market-data service remains bound to 127.0.0.1 and is
      // reached only by the server-side API routes.
      host: "::",
      // The worker owns 3102, so never let Vite move WebUI off its fixed port.
      strictPort: true,
      // Keep Vite's DNS-rebinding protection. A remote hostname is opt-in via
      // KLINE_REMOTE_HOST; localhost and literal IP addresses remain allowed.
      allowedHosts: configuredRemoteHost ? [configuredRemoteHost] : [],
      // Vinext/Miniflare can briefly reconnect its worker during cold start.
      // The application already surfaces actionable request failures in-page,
      // so do not leave Vite's developer overlay stuck over a healthy local app.
      hmr: { overlay: false },
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
