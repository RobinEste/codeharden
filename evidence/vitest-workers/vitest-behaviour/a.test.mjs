import { appendFileSync } from "node:fs";
import { it } from "vitest";
it("a", async () => {
  appendFileSync(new URL("./order.txt", import.meta.url), "start a\n");
  await new Promise((r) => setTimeout(r, 700));
  appendFileSync(new URL("./order.txt", import.meta.url), "end a\n");
});
