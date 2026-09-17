import { describe, it, expect } from "vitest";
import { extractTags } from "../src/lib/tags";

describe("extractTags", () => {
  it("解析行首与空白后的标签", () => {
    expect(extractTags("#工作 待办 #生活")).toEqual(["工作", "生活"]);
  });

  it("解析中文标点/括号/方括号后的标签", () => {
    expect(extractTags("（#中文）[#bracket] 【#quote】")).toEqual(["bracket", "quote", "中文"]);
  });

  it("不匹配 markdown 标题与 URL 片段", () => {
    expect(extractTags("# 标题不是标签\nhttps://x.com/#anchor")).toEqual([]);
  });

  it("过滤纯数字与十六进制颜色", () => {
    expect(extractTags("#2024 #ff0000 #abc")).toEqual([]);
  });

  it("去重并排序", () => {
    expect(extractTags("#b #a #b")).toEqual(["a", "b"]);
  });

  it("空内容返回空数组", () => {
    expect(extractTags("")).toEqual([]);
  });
});
