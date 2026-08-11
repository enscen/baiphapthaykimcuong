import assert from "node:assert/strict";
import test from "node:test";
import { canonicalFacebookUrl, dedupeFacebookItems, facebookPublishedAt } from "./facebook-reader.js";

test("parses Vietnamese Facebook dates", () => {
  const now = new Date("2026-07-14T00:00:00.000Z");
  assert.equal(facebookPublishedAt("V\u0169 Kim C\u01b0\u01a1ng\n1 Th\u00e1ng 7 l\u00fac 10:08", now), "2026-07-01T03:08:00.000Z");
  assert.equal(facebookPublishedAt("31 Th\u00e1ng 12 l\u00fac 23:00", new Date("2026-01-01T00:00:00.000Z")), "2025-12-31T16:00:00.000Z");
});

test("canonicalizes and removes duplicate Facebook captures", () => {
  const text = `Vũ Kim Cương\n1 tháng 7 lúc 03:08\nTRÁI TIM THẬT SỰ CỦA ĐẠO\n${"Nội dung bài pháp ".repeat(20)}`;
  const items = [
    { source_platform: "facebook", source_account: "https://www.facebook.com/vukim.cuong.71", source_item_id: "one", source_url: "https://www.facebook.com/vukim.cuong.71/posts/pfbidOne?comment_id=1&__cft__[0]=x", published_at: "2026-06-30T20:08:00.000Z", title: "1 tháng 7 lúc 03:08", caption_or_text: text, original_text: text, media_type: "text", media_urls: [], author_name: "Vũ Kim Cương" },
    { source_platform: "facebook", source_account: "https://www.facebook.com/vukim.cuong.71", source_item_id: "two", source_url: "https://www.facebook.com/vukim.cuong.71/posts/pfbidTwo?__tn__=R", published_at: "2026-06-30T20:08:00.000Z", title: "1 tháng 7 lúc 03:08", caption_or_text: text, original_text: text, media_type: "text", media_urls: [], author_name: "Vũ Kim Cương" },
    { source_platform: "facebook", source_account: "https://www.facebook.com/vukim.cuong.71", source_item_id: "bad", source_url: "https://www.facebook.com/another.profile?comment_id=1", published_at: "", title: "Đăng nhập", caption_or_text: "Đăng nhập\nBạn quên tài khoản ư?", original_text: "Đăng nhập\nBạn quên tài khoản ư?", media_type: "text", media_urls: [], author_name: "" },
  ] as any;
  assert.equal(canonicalFacebookUrl(items[0].source_url), "https://www.facebook.com/vukim.cuong.71/posts/pfbidOne");
  assert.equal(dedupeFacebookItems(items).length, 1);
});
