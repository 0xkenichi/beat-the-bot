import type { Address } from "viem";

/** Base mainnet. Every address below was checked against Base mainnet on 31 Oct 2026 (scripts/verify-chain.ts). */
export const CHAIN_ID = 8453 as const;

export const ADDR = {
  /** Native USDC on Base (docs.base.org). */
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  /** B20 Policy Registry precompile (docs.base.org/specifications/b20/reference/constants). */
  POLICY_REGISTRY: "0x8453000000000000000000000000000000000002",
  /** B20 factory precompile; tokenized stocks are created here. */
  B20_FACTORY: "0xB20f000000000000000000000000000000000000",
  /** "Onchain Registry" listed on docs.base.org's tokenized-stocks page. */
  TOKENIZED_STOCKS_REGISTRY: "0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD",
  /** ERC-8004 Identity and Reputation registries on Base (github.com/erc-8004/erc-8004-contracts). */
  ERC8004_IDENTITY: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  ERC8004_REPUTATION: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  /** Chainlink L2 sequencer uptime feed on Base. */
  SEQUENCER_UPTIME_FEED: "0xBCF85224fc0756B9Fa45aA7892530B47e10b6433",
  /** Aerodrome concentrated-liquidity factory that holds the deepest USDC pools for Coinbase stocks. */
  AERO_CL_FACTORY: "0x9CB220581b91b0C83223012FE69688b92aD07a76",
  /** SwapRouter bound to AERO_CL_FACTORY (factory() returns it; WETH9() returns Base WETH). */
  AERO_CL_ROUTER: "0x9Ee35Bf1bd69a03c6F0393582030fCe8Bb93D418",
  WETH: "0x4200000000000000000000000000000000000006",
} as const satisfies Record<string, Address>;

/** Fixed, empty address where QuoteProbe runtime code is placed by eth_call state override. */
export const QUOTE_PROBE_ADDRESS = "0x0000000000000000000000000000000000B07b07" as const;

/** The two chains the league knows. Trading is always Base mainnet; the contracts can be on either. */
export const CHAINS = {
  8453: {
    name: "Base",
    explorer: "https://basescan.org",
    rpc: "https://mainnet.base.org",
    erc8004Identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    hex: "0x2105",
  },
  84532: {
    name: "Base Sepolia",
    explorer: "https://sepolia.basescan.org",
    rpc: "https://sepolia.base.org",
    erc8004Identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    hex: "0x14a34",
  },
} as const satisfies Record<number, { name: string; explorer: string; rpc: string; erc8004Identity: Address; hex: string }>;
export type ContractsChainId = keyof typeof CHAINS;
export const explorerAddress = (chainId: number, a: string) => `${CHAINS[chainId as ContractsChainId]?.explorer ?? "https://basescan.org"}/address/${a}`;
export const explorerTx = (chainId: number, h: string) => `${CHAINS[chainId as ContractsChainId]?.explorer ?? "https://basescan.org"}/tx/${h}`;

export const BASESCAN = "https://basescan.org";
export const basescanAddress = (a: string) => `${BASESCAN}/address/${a}`;
export const basescanTx = (h: string) => `${BASESCAN}/tx/${h}`;
export const basescanToken = (token: string, holder?: string) =>
  holder ? `${BASESCAN}/token/${token}?a=${holder}` : `${BASESCAN}/token/${token}`;

/** keccak256 of the B20 policy scope names (docs.base.org/specifications/b20/reference/constants). */
export const POLICY_SCOPE = {
  TRANSFER_SENDER: "0xb81736c875ab819dd97f59f2a6542cfb731ad52b4ae15a6f24df2fb02b0327f5",
  TRANSFER_RECEIVER: "0x8a4b3fa2d8b921852bc0089c6ef0958aa6961897be36fd731330fe2cd23f8363",
  TRANSFER_EXECUTOR: "0x10be5173aff2a44e748bd9acd8b19fe34689581398a9db7ba2fb671e786ff7d8",
} as const;

export const USDC_DECIMALS = 6;
export const B20_DECIMALS = 8;
export const FEED_DECIMALS = 8;
export const WAD = 10n ** 18n;
