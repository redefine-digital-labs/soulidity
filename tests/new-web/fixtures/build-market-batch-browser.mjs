import {build} from 'esbuild'
import {createRequire} from 'node:module'
import {readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
const root=process.cwd(),out=process.argv[2],entry=path.join(root,'tests/new-web/fixtures/market-batch-browser.tsx')
if(!out)throw Error('Explicit temporary output directory required')
await build({entryPoints:[entry],outfile:path.join(out,'main.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',
  tsconfig:path.join(root,'web/tsconfig.json'),alias:{react:path.join(root,'web/node_modules/react'),'react-dom':path.join(root,'web/node_modules/react-dom')},
  define:{'process.env':'{}','process.env.NODE_ENV':'"development"'},plugins:[{name:'controlled-batch-hook',setup(b){
    b.onResolve({filter:/use-native-market-batch-list-actions$/},()=>({path:entry}))
  }}]})
const require=createRequire(path.join(root,'web/package.json'))
const css=(await readFile(path.join(root,'web/app/globals.css'),'utf8')).replace(/^@import url\([^\n]+\);\n/m,'')
const compiled=await require('postcss')([require('@tailwindcss/postcss')({base:path.join(root,'web')})]).process(css,{from:path.join(root,'web/app/globals.css')})
await writeFile(path.join(out,'style.css'),compiled.css)
await writeFile(path.join(out,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><title>S10 controlled selected-sale panel</title></head><body><div id="root"></div><script src="main.js"></script></body></html>')
console.log(out)
