import { encodeFunctionData } from "viem";
import { getSession } from "@/lib/session";
import { pickBookAbi } from "@btb/shared/abis";
import { contracts } from "@btb/shared/config";

/** Builds the PickBook.lock call for the player's own wallet. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Please sign in" }, { status: 401 });
  const pickBook = contracts().pickBook;
  if (!pickBook) return Response.json({ error: "Free play is not live yet" }, { status: 503 });
  const url = new URL(req.url);
  const week = Number(url.searchParams.get("week"));
  const picks = (url.searchParams.get("p") ?? "").split(",").map((x) => x.split(":").map(Number));
  if (!Number.isInteger(week) || week < 1 || picks.length !== 3 || picks.some((p) => p.length !== 2 || p.some((n) => !Number.isInteger(n) || n < 0))) {
    return Response.json({ error: "Pick three stocks with weights" }, { status: 400 });
  }
  if (picks.reduce((a, p) => a + p[1]!, 0) !== 10_000) return Response.json({ error: "Weights must add up to 100%" }, { status: 400 });
  const arg = picks.map(([tokenIndex, weightBps]) => ({ tokenIndex: tokenIndex!, weightBps: weightBps! })) as [
    { tokenIndex: number; weightBps: number },
    { tokenIndex: number; weightBps: number },
    { tokenIndex: number; weightBps: number },
  ];
  const data = encodeFunctionData({ abi: pickBookAbi, functionName: "lock", args: [week, arg] });
  return Response.json({ calls: [{ to: pickBook, data, value: "0x0" }] });
}
