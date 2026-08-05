import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Health check endpoint for Vercel deployment verification.
 * Responds with 200 OK and basic build/deployment metadata.
 */
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    version: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "unknown",
  });
}
