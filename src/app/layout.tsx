import type { Metadata } from "next";
import { SolanaWalletProvider } from "@/components/wallet-provider";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Accountability — SOL staking",
  description:
    "Stake SOL on a commitment with your group. A named judge decides the outcome.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SolanaWalletProvider>{children}</SolanaWalletProvider>
      </body>
    </html>
  );
}
