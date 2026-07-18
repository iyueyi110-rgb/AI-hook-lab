export interface TrackedTextFile {
  path: string;
  content: string;
}

export interface SecretFinding {
  path: string;
  line: number;
  rule: "provider_assignment" | "deepseek_key" | "ark_key" | "private_key";
}

const PLACEHOLDERS = new Set(["", "your_api_key_here", "placeholder", "changeme", "<secret>", "example"]);

function matchingRule(line: string): SecretFinding["rule"] | undefined {
  const assignment = line.match(/^\s*(?:DEEPSEEK_API_KEY|ARK_API_KEY)\s*=\s*([^\s#]+)\s*$/i);
  if (assignment && !PLACEHOLDERS.has(assignment[1]!.toLowerCase())) return "provider_assignment";
  if (/\bsk-[a-z0-9_-]{24,}\b/i.test(line)) return "deepseek_key";
  if (/\bark-[a-z0-9_-]{24,}\b/i.test(line)) return "ark_key";
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(line)) return "private_key";
  return undefined;
}

export function findTrackedSecretFindings(files: TrackedTextFile[]): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const file of files) {
    if (file.content.includes("\0")) continue;
    for (const [index, line] of file.content.split(/\r?\n/).entries()) {
      const rule = matchingRule(line);
      if (rule) findings.push({ path: file.path, line: index + 1, rule });
    }
  }
  return findings;
}
