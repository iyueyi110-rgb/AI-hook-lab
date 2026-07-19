import { EvaluationService } from "../lib/evaluation/service.ts";
import { getEvaluationRepository } from "../lib/evaluation/repository.ts";

const args = Object.fromEntries(process.argv.slice(3).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]] : ["", ""]).filter(([key]) => key));
const action = process.argv[2];
const password = process.env.EVAL_USER_PASSWORD;
if (!action || !password) {
  console.error("Usage: EVAL_USER_PASSWORD='12+ chars' npm run eval:user -- create-admin --username admin --display-name 管理员");
  console.error("   or: EVAL_USER_PASSWORD='12+ chars' EVAL_ADMIN_PASSWORD='...' npm run eval:user -- create --admin admin --username reviewer-a --display-name 评测员A --role evaluator");
  process.exit(1);
}

const service = new EvaluationService(getEvaluationRepository());
await service.initialize();
if (action === "create-admin") {
  const user = await service.setupFirstAdmin(args.username, args["display-name"], password);
  console.log(`Created admin ${user.username}`);
} else if (action === "create") {
  const adminPassword = process.env.EVAL_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error("EVAL_ADMIN_PASSWORD is required");
  const auth = await service.authenticate(args.admin, adminPassword);
  const user = await service.createUser(auth.user.id, { username: args.username, displayName: args["display-name"], password, role: args.role });
  console.log(`Created ${user.role} ${user.username}`);
} else {
  throw new Error(`Unsupported action: ${action}`);
}
