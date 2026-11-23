import { appendFileSync } from "node:fs";
import { it } from "vitest";
it("c", async () => {
  appendFileSync(new URL("./order.txt", import.meta.url), "start c\n");
  await new Promise((r) => setTimeout(r, 700));
  appendFileSync(new URL("./order.txt", import.meta.url), "end c\n");
});
