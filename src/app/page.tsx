import {
  EmbeddedWalletExperience,
  ExternalWalletExperience,
} from "@/components/wallet-experience";

export default function Home() {
  return process.env.NEXT_PUBLIC_PRIVY_APP_ID ? (
    <EmbeddedWalletExperience />
  ) : (
    <ExternalWalletExperience />
  );
}
