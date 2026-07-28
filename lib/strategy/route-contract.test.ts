import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = [
  "app/api/admin/strategies/route.ts",
  "app/api/admin/strategies/from-ops/route.ts",
  "app/api/admin/strategies/[cardId]/versions/[version]/route.ts",
  "app/api/admin/strategies/[cardId]/versions/[version]/actions/route.ts",
  "app/api/admin/strategies/[cardId]/versions/[version]/clone/route.ts",
  "app/api/admin/strategies/[cardId]/versions/[version]/diff/route.ts",
  "app/api/strategies/active/route.ts",
  "app/admin/dashboard/strategies/page.tsx",
  "components/StrategyAdminClient.tsx",
];

test("strategy routes and governed admin workspace expose the planned surface", async () => {
  for (const file of files) assert.equal((await readFile(file, "utf8")).length > 20, true, file);
  const page = await readFile("app/admin/dashboard/strategies/page.tsx", "utf8");
  assert.match(page, /管理员/);
  assert.match(page, /StrategyAdminClient/);
  const client = await readFile("components/StrategyAdminClient.tsx", "utf8");
  assert.match(client, /观察性数据，不代表因果/);
  assert.match(client, /版本差异/);
  assert.match(client, /approve_experiment/);
  assert.doesNotMatch(client, /activeRatio|autoRenew/);
});
