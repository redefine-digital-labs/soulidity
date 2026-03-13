import type { Metadata } from "next";
import "./globals.css";
import { PrivyProvider } from "@web/components/privy-provider";
import { AuthProvider } from "@web/components/auth-provider";

export const metadata: Metadata = {
  title: "CryptoOpenClaw",
  description: "AI 驱动的加密货币新闻与 OpenClaw 生态",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <PrivyProvider>
          <AuthProvider>{children}</AuthProvider>
        </PrivyProvider>
      </body>
    </html>
  );
}
