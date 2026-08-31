import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Each file runs a full `cdk synth` (Docker image asset fingerprinting,
    // dummy VPC lookups). That's seconds, not milliseconds, and running the
    // files in parallel just thrashes one CPU — serialize them and give the
    // synth room.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
