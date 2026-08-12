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
  //
  // Digital Asset Links: Android requires this file at the literal URL
  // /.well-known/assetlinks.json, but a `public/.well-known/` folder is NOT
  // served — verified live 2026-08-12: the file deployed and still 404'd while
  // /manifest.json from the same public/ folder served fine. Dot-folders are
  // dropped from the static output. So the file lives at a normal path and the
  // required URL is rewritten onto it. Do not "tidy" this back into public/.well-known/.
  async rewrites() {
    return [
      { source: "/demo", destination: "/order-demo.html" },
      { source: "/.well-known/assetlinks.json", destination: "/assetlinks.json" },
    ];
  },
  // TI Report folded into the Reports hub — old direct URLs land on the rail item.
  async redirects() {
    return [
      { source: "/tint/manager/ti-report", destination: "/reports?r=ti-report", permanent: false },
      { source: "/ti-report", destination: "/reports?r=ti-report", permanent: false },
    ];
  },
};

export default nextConfig;
