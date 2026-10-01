const { expo } = require("./app.json");

describe("Expo app configuration", () => {
  it("has the farmer app slug used by native builds", () => {
    expect(expo.slug).toBe("ekim-hasat");
  });
});
