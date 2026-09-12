import {
  DemoWalletExperience,
  EmbeddedWalletExperience,
} from "@/components/wallet-experience";
import { SOLANA_NETWORK } from "@/lib/solana";

export default function Home() {
  return process.env.NEXT_PUBLIC_PRIVY_APP_ID && SOLANA_NETWORK === "devnet" ? (
    <EmbeddedWalletExperience />
  ) : (
    <DemoWalletExperience />
  );
}
