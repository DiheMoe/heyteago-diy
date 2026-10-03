import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "喜茶杯贴 DIY",
  description: "本地处理图片并上传到喜茶账号的杯贴工具",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="min-h-full bg-neutral-100 font-sans text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
