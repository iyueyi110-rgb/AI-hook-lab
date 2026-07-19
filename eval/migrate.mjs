import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

import { getEvaluationRepository } from "../lib/evaluation/repository.ts";

const aliases = { real_operation: "real_user", evaluation: "evaluation_set", simulated: "simulation" };
const repository = getEvaluationRepository();
await repository.initialize();

if (process.env.DATABASE_URL) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query("UPDATE dashboard_event SET data_origin = 'real_user' WHERE data_origin = 'real_operation'");
    await pool.query("UPDATE dashboard_event SET data_origin = 'evaluation_set' WHERE data_origin = 'evaluation'");
    await pool.query("UPDATE dashboard_event SET data_origin = 'simulation' WHERE data_origin = 'simulated'");
  } catch (error) {
    if (!String(error).includes("dashboard_event")) throw error;
  } finally {
    await pool.end();
  }
} else {
  const eventsPath = path.join(process.cwd(), "data", "dashboard-events.json");
  try {
    const raw = await readFile(eventsPath, "utf8");
    const events = JSON.parse(raw);
    const changed = events.some((item) => aliases[item.dataOrigin]);
    if (changed) {
      const backup = `${eventsPath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      await copyFile(eventsPath, backup);
      for (const event of events) event.dataOrigin = aliases[event.dataOrigin] ?? event.dataOrigin;
      await writeFile(eventsPath, JSON.stringify(events, null, 2), "utf8");
      console.log(`Legacy dashboard events migrated; backup: ${backup}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

console.log(`Evaluation schema ready (${repository.mode})`);
