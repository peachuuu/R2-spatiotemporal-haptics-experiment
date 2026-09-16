import type { Metadata } from "next";
import "./globals.css";
import "./impact.css";

export const metadata: Metadata = {
  title: "Spirit Ruins · 时空触觉游戏实验",
  description: "面向游戏时空触觉编码研究的 Boss 战网页原型。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
