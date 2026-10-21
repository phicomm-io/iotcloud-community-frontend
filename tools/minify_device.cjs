// Transform each inline fragment separately: preserve script order and globals.
const fs = require('node:fs');
const esbuild = require('../frontend/node_modules/esbuild');
const terser = require('../frontend/node_modules/terser');

function minifyDevice(html) {
  return html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi,
    (_, open, code, close) => {
      if (/\bsrc\s*=/i.test(open)) return open + code + close;
      // Keep global names and script boundaries: product scripts consume them.
      // Extra compression runs only on the build host, with safe transforms.
      const result = terser.minify_sync(code, {
        ecma: 2020, compress: { passes: 3 }, mangle: true,
        format: { ascii_only: false, comments: /^!/ }
      });
      return open + result.code + close;
    }).replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
      (_, open, css, close) => open + esbuild.transformSync(css, {
        loader: 'css', charset: 'utf8', minify: true,
        target: ['chrome90', 'firefox90', 'safari14'], legalComments: 'inline'
      }).code + close);
}

module.exports = minifyDevice;
if (require.main === module) process.stdout.write(minifyDevice(fs.readFileSync(0, 'utf8')));
