import { cookies } from "next/headers";
import type { Lang } from "./copy";

export async function getLang(): Promise<Lang> {
  return (await cookies()).get("lang")?.value === "pcm" ? "pcm" : "en";
}
