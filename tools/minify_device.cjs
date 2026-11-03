// Keep script order and public globals. The device decodes ordinary gzip.
const fs = require('node:fs');
const esbuild = require('../frontend/node_modules/esbuild');
const parser = require('../frontend/node_modules/@babel/parser');
const terser = require('../frontend/node_modules/terser');
const trimExports = require('./trim_device_exports.cjs');
const trimStyles = require('./trim_device_styles.cjs');

function walk(node, visit) {
  if (!node || typeof node !== 'object' || visit(node) === false) return;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(value => walk(value, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

function translationScripts(html) {
  return [...html.matchAll(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi)]
    .map((match, index) => ({match, index, ast:/\bsrc\s*=/i.test(match[1]) ? null : parser.parse(match[2])}));
}

function translationTable(scripts) {
  let table;
  for (const script of scripts) walk(script.ast, node => {
    // Terser can also name unrelated product objects D, including M1's tiles.
    // Only the nonempty, literal bilingual dictionary is a translation table.
    if (node.type !== 'VariableDeclarator' || node.id?.name !== 'D' || node.init?.type !== 'ObjectExpression' ||
        !node.init.properties.length || !node.init.properties.every(property =>
          property.type === 'ObjectProperty' && !property.computed && property.key.type === 'StringLiteral' &&
          property.value.type === 'ArrayExpression' && property.value.elements.length === 2 &&
          property.value.elements.every(value => value?.type === 'StringLiteral'))) return;
    if (table) throw Error('Multiple translation tables');
    table = {...script, dictionary:node.init};
    return false;
  });
  return table;
}

function packTranslations(html, dictionaryScript) {
  const scripts = translationScripts(html);
  const table = translationTable(dictionaryScript === undefined ? scripts : scripts.filter(script => script.index === dictionaryScript));
  if (!table) return html;
  const {dictionary, match:[, , source]} = table, strings = new Set();
  for (const script of scripts) walk(script.ast, node => {
    if (node === dictionary) return false; // Values must not reference themselves.
    if (node.type === 'StringLiteral' && node.value) strings.add(node.value);
    if (node.type === 'TemplateElement' && node.value.cooked) strings.add(node.value.cooked);
  });
  for (const match of html.matchAll(/data-i18n(?:-ph|-aria)?=["']([^"']+)["']/g)) strings.add(match[1]);
  // Conservatively retain whole families used by dynamic keys, such as d.,
  // s.link_ and a1.effect. This also retains keys passed through helper APIs.
  const prefixes = [...strings].filter(value => value.includes('.') && value.length > 1);
  const pairs = dictionary.properties.map(property =>
    [property.key.value, property.value.elements.map(value => value.value)]
  ).filter(([key]) => strings.has(key) || prefixes.some(prefix => key.startsWith(prefix)));
  // Group languages into columns to improve compression; reconstruct the
  // exact existing dictionary API once, with no changes to displayed strings.
  const column = values => values.length && values.every(value => !value.includes('|'))
    ? `${JSON.stringify(values.join('|'))}.split('|')` : JSON.stringify(values);
  const expression = `((keys,en,zh)=>Object.fromEntries(keys.map((key,i)=>[key,[en[i],zh[i]]])))(${column(pairs.map(p=>p[0]))},${column(pairs.map(p=>p[1][0]))},${column(pairs.map(p=>p[1][1]))})`;
  const packed = source.slice(0, dictionary.start) + expression + source.slice(dictionary.end);
  return html.replace(source, () => packed);
}

async function minifyDevice(html, {trimDeviceExports=false,deviceModel=null}={}) {
  if(deviceModel!==null&&!['a1','m1','tc1'].includes(deviceModel))throw Error('Unknown native device model');
  if(deviceModel)html=html.replace(/\/\* @device-product \*\/null/g,JSON.stringify(deviceModel));
  if (trimDeviceExports) html = trimExports(html).html;
  // Eliminate impossible product branches before collecting translations.
  // Keep the original dictionary intact until its references are known.
  const dictionaryScript=translationTable(translationScripts(html))?.index;
  for (const [index, match] of [...html.matchAll(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi)].entries()) {
    if (/\bsrc\s*=/i.test(match[1])) continue;
    if(index===dictionaryScript)continue;
    const code = esbuild.transformSync(match[2], {
      loader:'js', charset:'utf8', target:'es2020', minify:true, legalComments:'none'
    }).code;
    const result = await terser.minify(code, {
      ecma:2020, compress:{passes:3}, mangle:true, format:{comments:false}
    });
    html = html.replace(match[0], () => match[1] + result.code + match[3]);
  }
  if(dictionaryScript!==undefined){
    // Use the script identified before minification, regardless of new names
    // or object shapes introduced in other product scripts by the minifier.
    html=packTranslations(html,dictionaryScript);
    const match=[...html.matchAll(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi)][dictionaryScript];
    const result=await terser.minify(match[2],{ecma:2020,compress:{passes:3},mangle:true,format:{comments:false}});
    html=html.replace(match[0],()=>match[1]+result.code+match[3]);
  }
  return html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (_, open, css, close) => open + esbuild.transformSync(deviceModel?trimStyles(css,deviceModel):css, {
      loader:'css', charset:'utf8', minify:true,
      target:['chrome90','firefox90','safari14'], legalComments:'none'
    }).code + close);
}
module.exports = minifyDevice;
module.exports.packTranslations = packTranslations;
if (require.main === module) minifyDevice(fs.readFileSync(0,'utf8'), {trimDeviceExports:process.argv.includes('--trim-device-exports'),deviceModel:process.argv.find(value=>value.startsWith('--device-model='))?.split('=')[1]||null}).then(result=>process.stdout.write(result)).catch(error=>{console.error(error);process.exitCode=1;});
