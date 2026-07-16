import { createInitialEvaluationState, getEvaluationRepository } from "../lib/evaluation/repository.ts";

const repository = getEvaluationRepository();
await repository.initialize();
const canonical = createInitialEvaluationState();
await repository.transaction((state) => {
  state.cases = canonical.cases;
  for (const prompt of canonical.promptVersions) {
    if (!state.promptVersions.some((item) => item.version === prompt.version)) state.promptVersions.push(prompt);
  }
  state.auditLog.push({ id: crypto.randomUUID(), action: "seed.applied", createdAt: new Date().toISOString(), payload: { cases: 60 } });
});
console.log(`Seeded 20 topics / 60 cases and baseline/candidate prompts (${repository.mode})`);
