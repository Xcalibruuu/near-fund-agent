import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("demo post drafts", () => {
  it("keeps each draft under 280 characters, with the required tag and no dash spam", () => {
    const text = readFileSync(new URL("../DEMO_POST.md", import.meta.url), "utf8").replaceAll("\r\n", "\n");
    const drafts = [...text.matchAll(/```text\n([\s\S]*?)```/g)].map((match) => match[1]?.trim() ?? "");
    expect(drafts.length).toBe(3);
    for (const draft of drafts) {
      expect(draft.length).toBeLessThanOrEqual(280);
      expect(draft).toMatch(/@NEARProtocol/);
      expect(draft).toMatch(/#NEARHackathon/);
      expect(draft).toMatch(/https:\/\/github.com\/Xcalibruuu\/near-fund-agent/);
      expect(draft).not.toMatch(/[—–]/);
      expect(draft.match(/#/g)?.length).toBe(1);
    }
  });
});
