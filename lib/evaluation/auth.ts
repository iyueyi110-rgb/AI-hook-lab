import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export interface PasswordDigest {
  hash: string;
  salt: string;
}

export async function hashPassword(password: string): Promise<PasswordDigest> {
  if (password.length < 12) throw new Error("密码至少需要 12 个字符");
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return { hash: derived.toString("hex"), salt };
}

export async function verifyPassword(password: string, digest: PasswordDigest): Promise<boolean> {
  const expected = Buffer.from(digest.hash, "hex");
  const actual = (await scrypt(password, digest.salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

