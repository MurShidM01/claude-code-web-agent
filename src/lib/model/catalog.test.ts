import { describe, expect, it } from "vitest";
import { normalizeCatalog, queryModels } from "@/lib/model/catalog";

describe("model catalog", () => {
  it("normalizes live payloads without inventing models", () => {
    const catalog = normalizeCatalog(
      [
        { id: "alpha", provider: "north", name: "Alpha", context: 128000, cost: { input: 1, output: 2, currency: "usd-cents", tokens: 1000000 } },
        { id: "beta", provider: "south", aliases: ["b"] },
        { nope: true },
      ],
      ["north"],
    );
    expect(catalog.models).toHaveLength(2);
    expect(catalog.providers).toEqual(["north", "south"]);
    expect(queryModels(catalog, { search: "alp" }).map((model) => model.id)).toEqual(["alpha"]);
    expect(queryModels(catalog, { provider: "south" })).toHaveLength(1);
  });
});
