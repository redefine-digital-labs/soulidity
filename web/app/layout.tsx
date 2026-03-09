import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CryptoOpenClaw",
  description: "AI-powered crypto news & OpenClaw ecosystem",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
