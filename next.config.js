/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // v55.83-VF — the PDF reader (pdfjs-dist, used in the browser by Egypt Bank to read statement PDFs) mentions the Node-only
  // "canvas" package for drawing pages. The Hub only reads the words, so that package is never needed in the bundle.
  webpack: (config) => {
    config.resolve.alias = Object.assign({}, config.resolve.alias, { canvas: false, "path2d-polyfill": false });
    return config;
  },
};

module.exports = nextConfig;
