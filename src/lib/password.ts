import { bytesToHex, hexToBytes, timingSafeEqual } from "./hash";

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32;

async function derive(password: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(saltHex), iterations, hash: "SHA-256" },
    key,
    KEY_LENGTH * 8,
  );
  return bytesToHex(bits);
}

/**
 * 生成可自描述的密码哈希：pbkdf2$<iterations>$<saltHex>$<hashHex>
 */
export async function createPasswordHash(password: string): Promise<string> {
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const [, iterations, salt, expected] = parts;
  const iterationsNum = Number(iterations);
  if (!Number.isInteger(iterationsNum) || iterationsNum <= 0) return false;
  const computed = await derive(password, salt, iterationsNum);
  return timingSafeEqual(computed, expected);
}
