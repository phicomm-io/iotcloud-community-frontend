const cp = require('node:child_process');
module.exports = path => cp.execFileSync('python3', [
  'common/web/page.py', path,
  ...(process.env.WEB_TEST_MINIFIED === '1' ? ['--minify'] : [])
], {encoding: 'utf8'});
