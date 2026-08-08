/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__"],
  testMatch: ["**/*.test.js"],
  testPathIgnorePatterns: ["/node_modules/"],
  collectCoverageFrom: [
    "src/**/*.js",
    "!src/server.js",
    "!src/turretsServer.js",
    "!src/swagger.js",
    "!src/db/migrate-status.js",
    "!**/node_modules/**",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "text-summary", "html", "lcov", "json-summary"],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 55,
      lines: 60,
      statements: 60,
    },
  },
  globalSetup: "<rootDir>/jest.globalSetup.js",
  setupFilesAfterFramework: [],
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
  maxWorkers: "50%",
};
