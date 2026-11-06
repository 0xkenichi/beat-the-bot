import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { cleanText, identityTx, joinTx, validWallet, withBuilderCode } from "../src/agentKit";
import { hasBuilderCode, builderCodeSuffix } from "../src/builderCode";
import { agentRosterAbi, erc8004IdentityAbi } from "../src/abis";
import { ADDR } from "../src/chain";

const CODE = "bc_test1234";
const strip = (data: `0x${string}`) => data.slice(0, data.length - (builderCodeSuffix(CODE).length - 2)) as `0x${string}`;

describe("agent kit transactions", () => {
  it("appends the Builder Code at the very end of the calldata", () => {
    const d = withBuilderCode("0x12345678", CODE);
    expect(d.endsWith(builderCodeSuffix(CODE).slice(2))).toBe(true);
    expect(hasBuilderCode(d, CODE)).toBe(true);
  });
  it("identity step calls ERC-8004 register(agentURI) on Base", () => {
    const t = identityTx("https://example.invalid/agents/w/0xabc/card.json", CODE);
    expect(t.to).toBe(ADDR.ERC8004_IDENTITY);
    expect(t.chainId).toBe(8453);
    expect(t.value).toBe("0");
    expect(hasBuilderCode(t.data, CODE)).toBe(true);
    const call = decodeFunctionData({ abi: erc8004IdentityAbi, data: strip(t.data) });
    expect(call.functionName).toBe("register");
    expect(call.args).toEqual(["https://example.invalid/agents/w/0xabc/card.json"]);
  });
  it("join step calls AgentRoster.register with the wallet, card, identity and terms hash", () => {
    const roster = "0x00000000000000000000000000000000000000aa";
    const wallet = "0x00000000000000000000000000000000000000bb";
    const terms = `0x${"11".repeat(32)}` as const;
    const t = joinTx(roster, wallet, "https://x.invalid/c.json", 42n, terms, CODE);
    expect(t.to).toBe(roster);
    const call = decodeFunctionData({ abi: agentRosterAbi, data: strip(t.data) });
    expect(call.functionName).toBe("register");
    expect(call.args).toEqual([wallet, "https://x.invalid/c.json", 42n, terms]);
  });
  it("cleans names and validates wallets", () => {
    expect(cleanText("  <b>Alpha\n\tBot</b>  ", 40)).toBe("bAlpha Bot/b");
    expect(cleanText("x".repeat(80), 40)).toHaveLength(40);
    expect(validWallet("0x000000000000000000000000000000000000bEEF")).toBe(true);
    expect(validWallet("0x0000000000000000000000000000000000000000")).toBe(false);
    expect(validWallet("not-an-address")).toBe(false);
  });
});
