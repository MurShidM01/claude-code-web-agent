import assert from "node:assert/strict";
import test from "node:test";
import { add, multiply } from "../src/math.js";

test("add adds", () => {
  assert.equal(add(2, 3), 5);
});

test("multiply multiplies", () => {
  assert.equal(multiply(2, 3), 6);
});
