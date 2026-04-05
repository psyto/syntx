import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/vaults",
  async redirects() {
    return [
      // syntx domain root → fabrknt.com/vaults
      {
        source: "/",
        destination: "https://fabrknt.com/vaults",
        permanent: true,
        basePath: false,
      },
    ];
  },
};

export default nextConfig;
