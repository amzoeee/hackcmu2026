import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Rehearsal commands keep their builds separate from the main app.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // This project already has hand-maintained instructions in AGENTS.md.
  agentRules: false,
  // Type checking remains a dedicated CI command. Next 16.3's checker currently
  // fails to parse TypeScript 5.9's otherwise-valid --showConfig output.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
