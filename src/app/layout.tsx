import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { SolanaWalletProvider } from "@/components/wallet-provider";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Finance your Responsibilities",
  description: "Stake SOL on a commitment. A judge settles it.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={plexSans.variable}>
      <body>
        <SolanaWalletProvider>{children}</SolanaWalletProvider>
      </body>
    </html>
  );
}
