import { readFile } from "node:fs/promises";
import path from "node:path";
import { MobileAccess } from "./mobile-access.mjs";
import { canUpgrade, createMobileAccessHandler } from "./mobile-access-http.mjs";
import { allowMobileFirewall } from "./mobile-firewall.mjs";
import { TailscaleAccess } from "./tailscale-access.mjs";

export function mobileAccessPlugin() {
  return {
    name: "kline-mobile-access",
    enforce: "pre",
    async configureServer(server) {
      const root = path.resolve(process.env.KLINE_DATA_DIR ?? path.join(server.config.root, ".local-data"));
      const service = await new MobileAccess({ stateFile: path.join(root, "mobile-access.json") }).init();
      const port = () => {
        const address = server.httpServer?.address();
        return address && typeof address === "object" ? address.port : server.config.server.port ?? 3101;
      };
      const tailscale = await new TailscaleAccess({ stateFile: path.join(root, "tailscale-access.json"), backendPort: port }).init();
      const externalHost = Symbol("verified-tailscale-host");
      // Vite 8 freezes host checks before configureServer. Validate the private ingress
      // before its request listener, then restore the real host before app middleware.
      // Ordinary requests never receive this localhost exception.
      const normalizeIngress = req => {
        if (tailscale.resolveRequest(req)?.kind !== "tailscale") return;
        req[externalHost] = req.headers.host;
        req.headers.host = `127.0.0.1:${port()}`;
      };
      server.httpServer?.prependListener("request", normalizeIngress);
      const probe = () => tailscale.inspect(true);
      await probe();
      const timer = setInterval(() => void probe(), 10_000);
      timer.unref();
      const styles = await readFile(path.join(server.config.root, "app/globals.css"), "utf8");
      const theme = styles.match(/:root\s*\{[^}]*\}/)?.[0];
      if (!theme) throw new Error("手机连接页面缺少主题配置。");
      const handler = createMobileAccessHandler({ service, port, firewall: allowMobileFirewall, tailscale, theme });
      server.middlewares.use((req, res, next) => {
        if (req[externalHost]) req.headers.host = req[externalHost];
        return handler(req, res, next);
      });
      const guardUpgrade = (req, socket) => {
        if (!canUpgrade(req, service, tailscale)) socket.destroy();
        else normalizeIngress(req);
      };
      server.httpServer?.prependListener("upgrade", guardUpgrade);
      server.httpServer?.once("close", () => {
        clearInterval(timer);
        server.httpServer?.removeListener("upgrade", guardUpgrade);
        server.httpServer?.removeListener("request", normalizeIngress);
      });
    },
  };
}
