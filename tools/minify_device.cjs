// Keep script order and public globals. The device decodes ordinary gzip.
const fs = require('node:fs');
const esbuild = require('../frontend/node_modules/esbuild');
const parser = require('../frontend/node_modules/@babel/parser');
const terser = require('../frontend/node_modules/terser');
const trimExports = require('./trim_device_exports.cjs');

function packTranslations(html) {
  const strings = new Set();
  let dictionary, source;
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id?.name === 'D' && node.init?.type === 'ObjectExpression') {
      dictionary = node.init;
      return; // Translation values must not count as references to themselves.
    }
    if (node.type === 'StringLiteral' && node.value) strings.add(node.value);
    if (node.type === 'TemplateElement' && node.value.cooked) strings.add(node.value.cooked);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  }
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const before = dictionary;
    walk(parser.parse(match[1]));
    if (before !== dictionary) source = match[1];
  }
  if (!dictionary) return html;
  for (const match of html.matchAll(/data-i18n(?:-ph|-aria)?=["']([^"']+)["']/g)) strings.add(match[1]);
  // Conservatively retain whole families used by dynamic keys, such as d.,
  // s.link_ and a1.effect. This also retains keys passed through helper APIs.
  const prefixes = [...strings].filter(value => value.includes('.') && value.length > 1);
  const pairs = dictionary.properties.map(property => {
    if (property.type !== 'ObjectProperty' || property.key.type !== 'StringLiteral' ||
        property.value.type !== 'ArrayExpression' || property.value.elements.length !== 2 ||
        property.value.elements.some(value => value.type !== 'StringLiteral')) throw Error('Unexpected translation table');
    return [property.key.value, property.value.elements.map(value => value.value)];
  }).filter(([key]) => strings.has(key) || prefixes.some(prefix => key.startsWith(prefix)));
  // Group languages into columns to improve compression; reconstruct the
  // exact existing dictionary API once, with no changes to displayed strings.
  const column = values => values.every(value => !value.includes('|'))
    ? `${JSON.stringify(values.join('|'))}.split('|')` : JSON.stringify(values);
  const expression = `((keys,en,zh)=>Object.fromEntries(keys.map((key,i)=>[key,[en[i],zh[i]]])))(${column(pairs.map(p=>p[0]))},${column(pairs.map(p=>p[1][0]))},${column(pairs.map(p=>p[1][1]))})`;
  const packed = source.slice(0, dictionary.start) + expression + source.slice(dictionary.end);
  return html.replace(source, () => packed);
}

async function minifyDevice(html, {trimDeviceExports=false}={}) {
  if (trimDeviceExports) html = trimExports(html).html;
  html = packTranslations(html);
  for (const match of [...html.matchAll(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi)]) {
    if (/\bsrc\s*=/i.test(match[1])) continue;
    const code = esbuild.transformSync(match[2], {
      loader:'js', charset:'utf8', target:'es2020', minify:true, legalComments:'none'
    }).code;
    const result = await terser.minify(code, {
      ecma:2020, compress:{passes:3}, mangle:true, format:{comments:false}
    });
    html = html.replace(match[0], () => match[1] + result.code + match[3]);
  }
  return html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (_, open, css, close) => open + esbuild.transformSync(css, {
      loader:'css', charset:'utf8', minify:true,
      target:['chrome90','firefox90','safari14'], legalComments:'none'
    }).code + close);
}
module.exports = minifyDevice;
module.exports.packTranslations = packTranslations;
if (require.main === module) minifyDevice(fs.readFileSync(0,'utf8'), {trimDeviceExports:process.argv.includes('--trim-device-exports')}).then(result=>process.stdout.write(result)).catch(error=>{console.error(error);process.exitCode=1;});
