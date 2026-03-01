import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
};

export default nextConfig;
