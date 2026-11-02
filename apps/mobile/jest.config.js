module.exports = {
  preset: "jest-expo",
  testMatch: ["**/?(*.)+(spec|test).[jt]s?(x)"],
  moduleNameMapper: { "^\\./local-date\\.js$": "<rootDir>/../../packages/domain/src/seasons/local-date.ts" },
};
