import { describe, it, expect } from "vitest";
import { signJwt, verifyJwt } from "../src/lib/jwt";
import { bytesToHex, hexToBytes, timingSafeEqual, sha256Hex } from "../src/lib/hash";
import { createPasswordHash, verifyPassword } from "../src/lib/password";

const SECRET = "test-secret";

describe("jwt", () => {
  it("签发后可验证并还原 payload", async () => {
    const token = await signJwt({ sub: 1, type: "access", iat: 1000, exp: 9999999999 }, SECRET);
    const payload = await verifyJwt(token, SECRET);
    expect(payload?.sub).toBe(1);
    expect(payload?.type).toBe("access");
  });

  it("错误密钥返回 null", async () => {
    const token = await signJwt({ sub: 1, type: "access", iat: 1, exp: 2e9 }, SECRET);
    expect(await verifyJwt(token, "wrong")).toBeNull();
  });

  it("过期 token 返回 null", async () => {
    const token = await signJwt({ sub: 1, type: "access", iat: 1, exp: 2 }, SECRET);
    expect(await verifyJwt(token, SECRET)).toBeNull();
  });

  it("格式非法返回 null", async () => {
    expect(await verifyJwt("not-a-jwt", SECRET)).toBeNull();
  });
});

describe("hash", () => {
  it("hex 与 bytes 往返一致", () => {
    expect(hexToBytes(bytesToHex(new Uint8Array([0, 255, 16])))).toEqual(new Uint8Array([0, 255, 16]));
  });

  it("timingSafeEqual 长度不同立即为假", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("abc", "abc")).toBe(true);
  });

  it("sha256Hex 结果正确", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("password", () => {
  it("哈希可验证", async () => {
    const stored = await createPasswordHash("s3cret!");
    expect(stored.startsWith("pbkdf2$")).toBe(true);
    expect(await verifyPassword("s3cret!", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("相同密码生成不同盐", async () => {
    const a = await createPasswordHash("same");
    const b = await createPasswordHash("same");
    expect(a).not.toBe(b);
  });
});
