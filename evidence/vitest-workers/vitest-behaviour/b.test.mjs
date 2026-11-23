import { appendFileSync } from "node:fs";
import { it } from "vitest";
it("b", async () => {
  appendFileSync(new URL("./order.txt", import.meta.url), "start b\n");
  await new Promise((r) => setTimeout(r, 700));
  appendFileSync(new URL("./order.txt", import.meta.url), "end b\n");
});
