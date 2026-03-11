import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quanti Backtester",
  description: "Personal backtesting platform for systematic trading strategies",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0a0a0f] antialiased">
        {children}
      </body>
    </html>
  );
}
