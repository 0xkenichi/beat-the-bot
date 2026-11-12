/** The three house agents. Their wallets are set by Kenichi; nothing else about them is secret. */
export type HouseAgent = {
  id: "momentum" | "contrarian" | "steady";
  name: string;
  strategy: string;
  keyEnv: string;
  addressEnv: string;
};

export const HOUSE_AGENTS: HouseAgent[] = [
  {
    id: "momentum",
    name: "Momentum",
    strategy: "Backs the three stocks that rose most over the last five trading days, in equal parts.",
    keyEnv: "BOT_MOMENTUM_PRIVATE_KEY",
    addressEnv: "BOT_MOMENTUM_ADDRESS",
  },
  {
    id: "contrarian",
    name: "Contrarian",
    strategy: "Backs the three stocks that fell most over the last five trading days, in equal parts.",
    keyEnv: "BOT_CONTRARIAN_PRIVATE_KEY",
    addressEnv: "BOT_CONTRARIAN_ADDRESS",
  },
  {
    id: "steady",
    name: "Steady",
    strategy: "Asks an AI model once a week for a balanced choice of the week's stocks; if the model can't answer, it goes with the steadiest ones.",
    keyEnv: "BOT_STEADY_PRIVATE_KEY",
    addressEnv: "BOT_STEADY_ADDRESS",
  },
];

/** Guardrails enforced in code for every house agent. */
export const GUARDRAILS = {
  maxWeightBps: 5000,
  cashBufferBps: 500,
  slippageBps: 100,
  maxOracleDeviationBps: 100,
  pauseBelowStartFraction: 0.5,
  // Base gas is well under a cent per swap, so even a $5 bot can hold all ten stocks.
  minTradeUsd: 0.25,
} as const;
