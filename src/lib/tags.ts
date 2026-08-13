/**
 * 从 memo 内容中解析 #tag 标签。
 * 规则：
 *  - `#` 后紧跟标签字符（字母/数字/_/-），且 `#` 前为行首或空白（避免 markdown 标题
 *    "# 标题"、URL 片段等误匹配）；
 *  - 过滤纯数字（如 #2024）与疑似十六进制颜色（如 #ff0000）。
 */
const TAG_RE = /(?:^|[\s（(【\[<])#([\p{L}\p{N}_-]+)/gu;

export function extractTags(content: string): string[] {
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(content)) !== null) {
    const tag = m[1];
    if (/^\d+$/.test(tag)) continue; // 纯数字
    if (/^[0-9a-fA-F]{3,6}$/.test(tag)) continue; // 疑似十六进制颜色
    seen.add(tag);
  }
  return [...seen].sort();
}
