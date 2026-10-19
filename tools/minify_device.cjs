// Transform each inline fragment separately: preserve script order and globals.
const fs = require('node:fs');
const esbuild = require('../frontend/node_modules/esbuild');

function minifyDevice(html) {
  return html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi,
    (_, open, code, close) => {
      if (/\bsrc\s*=/i.test(open)) return open + code + close;
      return open + esbuild.transformSync(code, {
        loader: 'js', charset: 'utf8', target: 'es2020',
        minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: true,
        legalComments: 'inline'
      }).code + close;
    }).replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
      (_, open, css, close) => open + esbuild.transformSync(css, {
        loader: 'css', charset: 'utf8', minify: true,
        target: ['chrome90', 'firefox90', 'safari14'], legalComments: 'inline'
      }).code + close);
}

module.exports = minifyDevice;
if (require.main === module) process.stdout.write(minifyDevice(fs.readFileSync(0, 'utf8')));
