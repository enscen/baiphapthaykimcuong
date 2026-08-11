import assert from "node:assert/strict";
import test from "node:test";
import { facebookPublishedAt } from "./facebook-reader.js";

test("parses Vietnamese Facebook dates", () => {
  const now = new Date("2026-07-14T00:00:00.000Z");
  assert.equal(facebookPublishedAt("V\u0169 Kim C\u01b0\u01a1ng\n1 Th\u00e1ng 7 l\u00fac 10:08", now), "2026-07-01T03:08:00.000Z");
  assert.equal(facebookPublishedAt("31 Th\u00e1ng 12 l\u00fac 23:00", new Date("2026-01-01T00:00:00.000Z")), "2025-12-31T16:00:00.000Z");
});
