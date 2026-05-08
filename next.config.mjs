/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self)" },
        ],
      },
    ];
  },
  // /demo → public/order-demo.html (URL stays /demo for cleaner WhatsApp shares).
  async rewrites() {
    return [
      { source: "/demo", destination: "/order-demo.html" },
    ];
  },
};

export default nextConfig;
