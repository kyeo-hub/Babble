/** 随机标识与令牌生成（URL 安全） */

const UID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** 生成随机 uid（小写字母+数字，默认 12 位） */
export function genUid(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) {
    out += UID_CHARS[bytes[i] % UID_CHARS.length];
  }
  return out;
}

/** 生成长期 API Token 明文（bab_ 前缀，48 hex 位） */
export function genToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `bab_${hex}`;
}

/** 生成分享短码（base62，默认 8 位） */
export function genShareCode(length = 8): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}
