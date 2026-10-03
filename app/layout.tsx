import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "우리장부 · 가정 재무 대시보드",
  description: "개인과 부부가 거래, 예산, 자산을 함께 관리하는 가계부",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
