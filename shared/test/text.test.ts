import { describe, expect, it } from "vitest";
import { listText } from "../src/text";
import { personalMessage } from "../src/messages";
import type { Row, WeekTable } from "../src/league";

describe("lists of names read the way a person writes them", () => {
  it("joins one, two and three names", () => {
    expect(listText([])).toBe("");
    expect(listText(["Momentum"])).toBe("Momentum");
    expect(listText(["Atlas", "Steady"])).toBe("Atlas and Steady");
    expect(listText(["Atlas", "Steady", "Momentum"])).toBe("Atlas, Steady and Momentum");
  });
  it("the Friday DM lists the bots you beat", () => {
    const bot = (name: string, ret: number) => ({ wallet: `0x${name}`, tier: "bot", name, ret }) as Row;
    const t = { weekId: 2, bots: [bot("Contrarian", 0.08), bot("Atlas", 0.03), bot("Steady", 0.01), bot("Momentum", -0.02)] } as WeekTable;
    const me = { wallet: "0xme", tier: "paper", name: "ada", ret: 0.04 } as Row;
    expect(personalMessage(t, me)).toContain("You beat Atlas, Steady and Momentum. Contrarian beat you by 4.0%.");
  });
});
