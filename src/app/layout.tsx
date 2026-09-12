import type { Metadata } from "next";
import { SolanaWalletProvider } from "@/components/wallet-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solara — accountability stakes",
  description:
    "Stake test SOL on a commitment with your group. A named judge settles the outcome after the deadline.",
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
