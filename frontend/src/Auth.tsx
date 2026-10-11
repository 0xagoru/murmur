import { PrivyProvider } from "@privy-io/react-auth";
import { bsc } from "viem/chains";
import type { ReactNode } from "react";
import type { Config } from "./api";
export default function Auth({
  config,
  children,
}: {
  config: Config;
  children: ReactNode;
}) {
  return (
    <PrivyProvider
      appId={config.privyAppId}
      config={{
        appearance: { theme: "light", accentColor: "#0e6b47", logo: undefined },
        loginMethods: ["email", "wallet"],
        defaultChain: bsc,
        supportedChains: [bsc],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
