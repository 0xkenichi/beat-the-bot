import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { createPublicClient, createWalletClient, http, keccak256, toBytes, zeroAddress, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { agentRosterAbi, agentRosterBytecode, pickBookAbi, pickBookBytecode, UNIVERSE } from "@btb/shared";
import { openDb, type Db } from "@btb/shared/db";
import { lockTypedData, registerTypedData, type Pick } from "@btb/shared/agentKit";
import { indexLocks, indexRoster } from "../src/index";

// Anvil's well-known public development keys (not anyone's wallet).
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
] as const;
const anvilBin = [`${homedir()}/.foundry/bin/anvil`, "/usr/local/bin/anvil"].find(existsSync);
const PORT = 8600 + Math.floor(Math.random() * 300);
const rpc = `http://127.0.0.1:${PORT}`;

describe.skipIf(!anvilBin)("indexer against real contract events (local Anvil chain)", () => {
  let anvil: ChildProcess;
  let client: PublicClient;
  let db: Db;
  const [owner, player, agent, signOnly] = KEYS.map((k) => privateKeyToAccount(k));
  const wallet = (i: number) => createWalletClient({ account: privateKeyToAccount(KEYS[i]!), chain: foundry, transport: http(rpc) });
  let roster: Address;
  let pickBook: Address;
  const terms = keccak256(toBytes("terms"));
  // viem caches the block number for a few seconds; tests read the head fresh.
  const head = () => client.getBlockNumber({ cacheTime: 0 });

  beforeAll(async () => {
    anvil = spawn(anvilBin!, ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    client = createPublicClient({ chain: foundry, transport: http(rpc) }) as PublicClient;
    for (let i = 0; i < 50; i++) {
      try { await client.getChainId(); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
    }
    const deploy = async (abi: never, bytecode: `0x${string}`, args: unknown[]) => {
      const hash = await wallet(0).deployContract({ abi, bytecode, args: args as never } as never);
      return (await client.waitForTransactionReceipt({ hash })).contractAddress!;
    };
    pickBook = await deploy(pickBookAbi as never, pickBookBytecode, [owner!.address]);
    // The owner doubles as the registrar that relays signed agent entries.
    roster = await deploy(agentRosterAbi as never, agentRosterBytecode, [owner!.address, zeroAddress, owner!.address, terms, "https://example.invalid/terms"]);
    process.env.NEXT_PUBLIC_PICKBOOK = pickBook;
    process.env.NEXT_PUBLIC_AGENTROSTER = roster;

    const now = BigInt((await client.getBlock()).timestamp);
    const send = async (i: number, address: Address, abi: never, functionName: string, args: unknown[]) =>
      client.waitForTransactionReceipt({ hash: await wallet(i).writeContract({ address, abi, functionName, args } as never) });
    await send(0, pickBook, pickBookAbi as never, "setWeek", [1, now - 60n, now + 3600n, UNIVERSE.map((u) => u.address)]);
    await send(1, pickBook, pickBookAbi as never, "lock", [1, [{ tokenIndex: 0, weightBps: 5000 }, { tokenIndex: 3, weightBps: 3000 }, { tokenIndex: 7, weightBps: 2000 }]]);
    await send(2, roster, agentRosterAbi as never, "register", [agent!.address, "https://example.invalid/card.json", 7n, terms]);

    db = await openDb("pglite:");
    await db.query("insert into agent_profiles (wallet, name, strategy) values ($1, 'Alpha Agent', 'Buys the two cheapest stocks each week.')", [agent!.address.toLowerCase()]);
  }, 60_000);

  afterAll(async () => {
    anvil?.kill();
    await db?.close();
  });

  it("stores a free-play lock from the PickBook Locked event", async () => {
    expect(await indexLocks(client, db, await head())).toBe(1);
    const rows = await db.query<{ week: number; wallet: string; picks: unknown }>("select week, wallet, picks from paper_locks");
    expect(rows).toEqual([{ week: 1, wallet: player!.address.toLowerCase(), picks: [{ tokenIndex: 0, weightBps: 5000 }, { tokenIndex: 3, weightBps: 3000 }, { tokenIndex: 7, weightBps: 2000 }] }]);
  });

  it("adds an entered agent from the AgentRoster Registered event, with its kit profile", async () => {
    expect(await indexRoster(client, db, await head())).toBe(1);
    const [a] = await db.query<{ id: string; name: string; house: boolean; erc8004_id: string; roster_id: number; paused: boolean }>("select id, name, house, erc8004_id, roster_id, paused from agents");
    expect(a).toEqual({ id: "agent-1", name: "Alpha Agent", house: false, erc8004_id: "7", roster_id: 1, paused: false });
  });

  it("pauses the agent when the organiser removes it from the table", async () => {
    const hash = await wallet(0).writeContract({ address: roster, abi: agentRosterAbi, functionName: "setActive", args: [1n, false] });
    await client.waitForTransactionReceipt({ hash });
    await indexRoster(client, db, await head());
    const [a] = await db.query<{ paused: boolean }>("select paused from agents where id = 'agent-1'");
    expect(a!.paused).toBe(true);
  });

  it("relays an agent's signed entry and signed picks, so the agent needs no gas on the league chain", async () => {
    const chainId = 31337 as never;
    const deadline = BigInt((await client.getBlock()).timestamp) + 3600n;
    const card = "https://example.invalid/agents/w/sign-only/card.json";
    const entry = registerTypedData({ roster, chainId, wallet: signOnly!.address, metadataURI: card, erc8004Id: 42n, identityChainId: 8453, termsHash: terms, deadline });
    const entrySig = await signOnly!.signTypedData(entry);
    expect(await client.verifyTypedData({ address: signOnly!.address, signature: entrySig, ...entry })).toBe(true);
    await client.waitForTransactionReceipt({
      hash: await wallet(0).writeContract({ address: roster, abi: agentRosterAbi, functionName: "registerFor", args: [signOnly!.address, card, 42n, 8453n, terms, deadline, entrySig] }),
    });

    const picks: Pick[] = [{ tokenIndex: 1, weightBps: 4000 }, { tokenIndex: 2, weightBps: 3500 }, { tokenIndex: 9, weightBps: 2500 }];
    const nonce = await client.readContract({ address: pickBook, abi: pickBookAbi, functionName: "nonces", args: [signOnly!.address] });
    const lock = lockTypedData({ pickBook, chainId, player: signOnly!.address, week: 1, picks, nonce, deadline });
    const lockSig = await signOnly!.signTypedData(lock);
    await client.waitForTransactionReceipt({
      hash: await wallet(0).writeContract({ address: pickBook, abi: pickBookAbi, functionName: "lockFor", args: [signOnly!.address, 1, picks as never, deadline, lockSig] }),
    });

    expect(await client.getTransactionCount({ address: signOnly!.address })).toBe(0);
    await indexRoster(client, db, await head());
    await indexLocks(client, db, await head());
    const [a] = await db.query<{ erc8004_id: string; identity_chain: number; roster_id: number }>("select erc8004_id, identity_chain, roster_id from agents where wallet = $1", [signOnly!.address.toLowerCase()]);
    expect(a).toEqual({ erc8004_id: "42", identity_chain: 8453, roster_id: 2 });
    const [l] = await db.query<{ picks: unknown }>("select picks from paper_locks where wallet = $1 and week = 1", [signOnly!.address.toLowerCase()]);
    expect(l!.picks).toEqual(picks);
  });
});
