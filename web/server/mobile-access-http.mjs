import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { DEVICE_TTL, isLocalAdmin, isPrivateAddress, listLanAddresses, mobileCookie } from "./mobile-access.mjs";
import { mobileConnectPage } from "./mobile-connect-page.mjs";

const prefix = "/api/mobile-access";
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const remoteContext = Symbol("mobile-remote-context");
const sameOrigin = (req) => req.headers.origin === (req[remoteContext]?.origin ?? `http://${req.headers.host}`);
const hasSafeOrigin = (req) => !req.headers.origin || sameOrigin(req);
export function configuredRemoteOrigin(remoteHost, port) {
  const host = typeof remoteHost === "string" ? remoteHost.trim().toLowerCase() : "";
  // KLINE_REMOTE_HOST is one explicit DNS name, never a wildcard or an origin.
  if (host.length > 253 || host.endsWith(".localhost") || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return new URL(`http://${host}:${port}`).origin;
}
function classify(req, tailscale, directOrigin) {
  const remote = tailscale?.resolveRequest(req);
  if (remote?.kind === "denied") return { denied: true };
  if (remote?.kind === "tailscale") { req[remoteContext] = remote; return { local: false, remote: true }; }
  // Serve identity and forwarding headers may never grant localhost management rights.
  if (req.url?.startsWith("/__kline-tailscale/") || Object.keys(req.headers).some(key => key.startsWith("tailscale-") || key.startsWith("x-forwarded-") || key === "forwarded")) return { denied: true };
  const direct = directOrigin && req.headers.host?.toLowerCase() === new URL(directOrigin).host;
  return { local: isLocalAdmin(req), remote: isLanRequest(req) || Boolean(direct) };
}
function isLanRequest(req) {
  if (!isPrivateAddress(req.socket.remoteAddress)) return false;
  try {
    const host = new URL(`http://${req.headers.host}`).hostname;
    return isPrivateAddress(host) && host === req.socket.localAddress?.replace(/^::ffff:/, "");
  } catch { return false; }
}
function cookieToken(req) {
  return (req.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${mobileCookie}=`))?.slice(mobileCookie.length + 1);
}
export function canUpgrade(req, service, tailscale, directOrigin) {
  const access = classify(req, tailscale, directOrigin);
  return !access.denied && ((access.local && hasSafeOrigin(req)) || (access.remote && sameOrigin(req) && service.authorize(cookieToken(req))));
}
function send(res, status, value, type = "application/json; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(type.startsWith("application/json") ? JSON.stringify(value) : value);
}
async function readBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")) fail("请刷新页面后重新操作。", 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 4096) fail("请求内容过长，请缩短设备名称后重试。", 413);
    chunks.push(Buffer.from(chunk));
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result;
  } catch { fail("请求内容不完整，请刷新页面后重试。"); }
}

/** Runs before Vinext, static files and RSC so no remote path can bypass authorization. */
export function createMobileAccessHandler({ service, interfaces, port, firewall, tailscale, remoteHost, theme = "" }) {
  const rates = new Map();
  const status = async () => {
    const current = service.status();
    const remote = await tailscale?.inspect();
    const fragment = current.challenge ? `#code=${current.challenge.code}` : "";
    const addresses = listLanAddresses(interfaces?.()).map(item => ({ ...item, url: `http://${item.address}:${port()}/mobile-connect${fragment}` }));
    const direct = configuredRemoteOrigin(remoteHost, port());
    if (direct) addresses.push({ name: "自有域名", kind: "direct", address: new URL(direct).hostname, url: `${direct}/mobile-connect${fragment}` });
    if (remote?.state === "ready") addresses.push({ name: "Tailscale", address: "tailscale", url: `${remote.url}/mobile-connect${fragment}` });
    return { ...current, tailscale: remote, adminToken: service.adminToken, firewallAvailable: process.platform === "win32", addresses };
  };
  function rateLimit(req) {
    const now = Date.now();
    for (const [key, value] of rates) if (value.until <= now) rates.delete(key);
    const key = req.socket.remoteAddress;
    const rate = rates.get(key) ?? { count: 0, until: now + 60_000 };
    if (rate.count >= 20 || rates.size >= 512) fail("尝试次数较多，请稍后重新扫码。", 429);
    rate.count++;
    rates.set(key, rate);
  }
  return async (req, res, next) => {
    try {
      const access = classify(req, tailscale, configuredRemoteOrigin(remoteHost, port()));
      const local = access.local;
      if (access.denied || (!local && !access.remote)) fail("请通过电脑提供的手机连接地址访问。", 403);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname;
      const reserved = pathname === prefix || pathname.startsWith(`${prefix}/`);
      if (reserved) {
        if (!hasSafeOrigin(req)) fail("请从本机页面重新操作。", 403);
        if (pathname === `${prefix}/session` && req.method === "GET") {
          return send(res, 200, { enabled: service.state.enabled, authorized: local || service.authorize(cookieToken(req)) });
        }
        if (pathname === `${prefix}/pair` || pathname === `${prefix}/claim`) {
          if (req.method !== "POST") fail("请通过手机连接页面继续。", 405);
          if (!sameOrigin(req)) fail("请从扫码打开的页面继续。", 403);
          const body = await readBody(req);
          if (pathname.endsWith("/pair")) {
            rateLimit(req);
            return send(res, 200, service.pair(body.code, body.name));
          }
          const result = await service.claim(body.id, body.secret);
          if (result.status === "approved") res.setHeader("Set-Cookie", `${mobileCookie}=${result.token}; Path=/; Max-Age=${DEVICE_TTL / 1000}; HttpOnly; SameSite=Strict${req[remoteContext] ? "; Secure" : ""}`);
          return send(res, 200, { status: result.status });
        }
        if (!local) fail("请在电脑本机页面管理手机访问。", 403);
        if (pathname === `${prefix}/qr` && req.method === "GET") {
          const current = await status();
          const address = current.addresses.find((item) => item.address === url.searchParams.get("address"));
          if (!address || !current.enabled || !current.challenge || url.searchParams.get("code") !== current.challenge.code) fail("二维码已过期，请刷新后重新扫码。");
          return send(res, 200, await QRCode.toString(address.url, { type: "svg", errorCorrectionLevel: "M", margin: 4, width: 224 }), "image/svg+xml");
        }
        if (pathname !== prefix) fail("没有找到连接操作，请刷新页面。", 404);
        if (req.method === "GET") return send(res, 200, await status());
        if (req.method !== "POST") fail("请刷新页面后重新操作。", 405);
        if (!sameOrigin(req) || req.headers["x-kline-mobile-admin"] !== service.adminToken) fail("电脑连接信息已更新，请刷新后重试。", 403);
        const body = await readBody(req);
        switch (body.action) {
          case "enable": await service.setEnabled(true); service.rotateChallenge(); break;
          case "disable": await service.setEnabled(false); break;
          case "rotate": service.rotateChallenge(); break;
          case "approve": service.approve(body.id, body.number); break;
          case "deny": service.deny(body.id); break;
          case "revoke": await service.revoke(body.id); break;
          case "firewall": await firewall(port()); break;
          case "tailscale-refresh": await tailscale?.inspect(true); break;
          case "tailscale-open": await tailscale?.openClient(); break;
          case "tailscale-prepare":
            if (!service.state.enabled) fail("请先开启手机访问。");
            if (!tailscale) fail("请更新电脑端后重新连接。", 503);
            if ((await tailscale.prepare(port())).state === "ready") service.rotateChallenge();
            break;
          case "tailscale-disable": await tailscale?.disable(); break;
          default: fail("没有找到连接操作，请刷新页面。");
        }
        return send(res, 200, await status());
      }
      if (pathname === "/mobile-connect" && req.method === "GET") {
        const nonce = randomBytes(18).toString("base64");
        res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
        return send(res, 200, mobileConnectPage(nonce, theme), "text/html; charset=utf-8");
      }
      if (!local) {
        if (!hasSafeOrigin(req) || (!["GET", "HEAD"].includes(req.method) && !sameOrigin(req))) fail("请从手机训练页面重新操作。", 403);
        if (!service.authorize(cookieToken(req))) {
          if (req.method === "GET" && req.headers.accept?.includes("text/html")) {
            res.setHeader("Location", "/mobile-connect");
            return send(res, 302, "", "text/plain");
          }
          return send(res, 401, { error: "手机尚未授权或访问已关闭，请在电脑上重新配对。", mobilePairingRequired: true });
        }
        // Browser modules and dev internals are implementation artifacts, never a mobile capability.
        // Regular bundled application assets (including Vite-transformed modules) still pass below.
        if (pathname.startsWith("/@fs/") || pathname.startsWith("/.local-data/") || pathname.startsWith("/server/") || pathname.startsWith("/.wrangler/")) fail("此内容不能通过手机访问。", 403);
      }
      return next();
    } catch (error) {
      return send(res, error.status ?? 503, { error: error.status ? error.message : "连接暂时不可用，请在电脑上检查服务状态后重试。" });
    }
  };
}
