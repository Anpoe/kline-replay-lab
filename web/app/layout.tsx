import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const resizeObserverErrorGuard = `
(() => {
  const messages = new Set([
    "ResizeObserver loop completed with undelivered notifications.",
    "ResizeObserver loop limit exceeded"
  ]);
  window.addEventListener("error", (event) => {
    const message = event.message || (event.error instanceof Error ? event.error.message : "");
    if (!messages.has(message)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();`;

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3101";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;
  return {
    title: "K线训练营 2.0",
    description: "多市场历史 K 线回放、模拟交易与结构化复盘训练台。",
    openGraph: {
      title: "K线训练营 2.0",
      description: "逐根回放 · 模拟交易 · 结构化复盘",
      images: [{ url: imageUrl, width: 1536, height: 1024, alt: "K线训练营 2.0" }],
    },
    twitter: { card: "summary_large_image", images: [imageUrl] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head><script dangerouslySetInnerHTML={{ __html: resizeObserverErrorGuard }} /></head>
      <body>{children}</body>
    </html>
  );
}
