import { createHash, randomUUID } from 'node:crypto'
import { createServer, type ViteDevServer } from 'vite'
import { incomeBrowserRoot } from '../../helpers/commerce-income-browser-root'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { chromeCdp } from '../../helpers/chrome-cdp'
import { browserRecoveryWire as wire, browserRecoveryUnwire as unwire } from '../../helpers/browser-recovery-wire'
import type { makerProductIncomeControllerFixture } from './maker-product-income'
const candidate = fileURLToPath(new URL('../../../', import.meta.url))
const artifactRoot = process.env.COMMERCE_INCOME_BROWSER_ARTIFACT_ROOT ?? resolve(candidate, '.test-artifacts/income-browser')

/** Actual index/main/SPA/Providers and CSS. Only original readonly transport
 * and Root capability factories are injected; bridge only seeds via actual Host.
 * RPC/full simulation witnesses are controlled, never a real wallet/payment.
 */
export async function makerProductIncomeBrowser(x: Awaited<ReturnType<typeof makerProductIncomeControllerFixture>>, options: { missingSource?: boolean; missingModels?: boolean; wallet?: boolean; deferRecoveryCompletion?: boolean } = {}) {
  if(process.env.CLAWNEWS_LOAD_ENV_LOCAL!=='false')throw Error('LOCAL_ENV_READ_MUST_BE_DISABLED')
  const overlay=incomeBrowserRoot({candidate,overlayRoot:process.env.COMMERCE_INCOME_BROWSER_CANONICAL_ROOT,tuplePath:process.env.COMMERCE_INCOME_BROWSER_OVERLAY_TUPLE,tupleSha256:process.env.COMMERCE_INCOME_BROWSER_OVERLAY_TUPLE_SHA256}),root=overlay.root
  let vite: ViteDevServer | undefined, chrome: ChildProcess | undefined, profile: string | undefined, cdp: ReturnType<typeof chromeCdp> | undefined
  let primary = '', secondary = '', observedOrigin: string | null = null
  const downloads: Array<{name:string;sha256:string;text:string;directory:string}> = []
  const transcript: unknown[] = [], rawExchanges: Array<{request:string;response:string}> = []
  const runtimeExceptions: unknown[] = [], consoleErrors: unknown[] = []; let eventBytes = Buffer.alloc(0), closed = false
  const requests: Array<{ service: string; method: string; mode: string; digest?: string; credential: boolean; bytes?: string }> = []
  const bootstrap = `globalThis.__incomeMode='missing';globalThis.__documentIdentity=crypto.randomUUID();
const wire=v=>typeof v==='bigint'?{$browserWire:'bigint',value:String(v)}:v instanceof Uint8Array?{$browserWire:'bytes',value:btoa(String.fromCharCode(...v))}:v===undefined?{$browserWire:'undefined'}:Array.isArray(v)?v.map(wire):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,wire(x)])):v;
const unwire=v=>v?.$browserWire==='bigint'?BigInt(v.value):v?.$browserWire==='bytes'?Uint8Array.from(atob(v.value),c=>c.charCodeAt(0)):v?.$browserWire==='undefined'?undefined:Array.isArray(v)?v.map(unwire):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,unwire(x)])):v;
globalThis.__incomeUnwire=unwire;globalThis.__makeIncomeClient=signal=>{const mode=globalThis.__incomeMode;const call=(service,method)=>async(params={},options={})=>{const r=await fetch('/__income_rpc/'+mode,{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify({service,method,params:wire(params)}),signal:options.abort??params.signal??signal});const body=await r.json();if(body.error)throw Object.assign(Error(body.error.message),{code:body.error.code});const result=unwire(body.result);if(method==='simulateTransaction')globalThis.__afterMakerSimulation=true;return result};return{core:Object.fromEntries(['getChainIdentifier','getMoveFunction','listOwnedObjects'].map(m=>[m,call('core',m)])),ledgerService:Object.fromEntries(['getObject','getServiceInfo','getTransaction','getCheckpoint','getEpoch'].map(m=>[m,call('ledgerService',m)])),transactionExecutionService:{simulateTransaction:call('transactionExecutionService','simulateTransaction')}}};`
  const bridge = `import * as J from '/lib/soulidity/maker-product-income-journal.ts';import{createRootMakerProductIncomeController}from'/lib/soulidity/commerce/maker-product-income-controller.ts';
const installations=${JSON.stringify([x.installation])};const executionModels=${JSON.stringify(x.executionModels)};
export async function seed(encoded){const input=globalThis.__incomeUnwire(encoded),client=globalThis.__makeIncomeClient(),signal=new AbortController().signal;const controller=createRootMakerProductIncomeController({installations,executionModels,client:()=>client});const observation=await controller.observe(input.selection,signal,()=>input.actor);const review=controller.makeReview(observation,input.draft);const value=await controller.createPreflight(review)({...review.request,client,signal,getActorAddress:()=>input.actor});return{key:J.makerProductIncomeFundKey(input.selection.target),text:value.retainedText,digest:value.preflight.prepared.packet.digest}}
export{J};`
  const capability = `import{createRootMakerProductIncomeController}from'/lib/soulidity/commerce/maker-product-income-controller.ts';
const installations=${JSON.stringify(options.missingSource?[]:[x.installation])};const executionModels=${JSON.stringify(options.missingSource||options.missingModels?[]:x.executionModels)};
export function createConfiguredMakerProductIncomeController(){const controller=createRootMakerProductIncomeController({installations,executionModels,client:signal=>globalThis.__makeIncomeClient(signal),isCurrent:()=>globalThis.__makerProductIncomeSourceCurrent===true});if(!${JSON.stringify(options.deferRecoveryCompletion===true)})return controller;return{...controller,resume:async input=>{const result=await controller.resume(input);globalThis.__makerRecoveryActualCompleted=true;await new Promise(resolve=>{globalThis.__releaseMakerRecoveryCompletion=resolve});return result}}}`
  const walletBootstrap = `globalThis.__makerProductIncomeSourceCurrent=true;globalThis.__walletSigns=0;globalThis.__afterMakerSimulation=false;
if(${JSON.stringify(options.wallet !== false)}){let address=${JSON.stringify(x.actor)};const listeners=new Set();const account=()=>({address,publicKey:new Uint8Array(32),chains:['sui:mainnet','sui:testnet'],features:['sui:signTransaction','sui:signPersonalMessage','sui:signAndExecuteTransaction']});let accounts=[account()];const refuse=async()=>{globalThis.__walletSigns++;throw Error('NO_SIGNING_ALLOWED')};const wallet={version:'1.0.0',name:'Controlled Original Review Wallet',icon:'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',chains:['sui:mainnet','sui:testnet'],get accounts(){return accounts},features:{'standard:connect':{version:'1.0.0',connect:async()=>{globalThis.__walletConnected=true;return{accounts}}},'standard:disconnect':{version:'1.0.0',disconnect:async()=>{accounts=[];listeners.forEach(f=>f({accounts}))}},'standard:events':{version:'1.0.0',on:(event,listener)=>{if(event==='change')listeners.add(listener);return()=>listeners.delete(listener)}},'sui:signTransaction':{version:'2.0.0',signTransaction:refuse},'sui:signPersonalMessage':{version:'1.0.0',signPersonalMessage:refuse},'sui:signAndExecuteTransaction':{version:'2.0.0',signAndExecuteTransaction:refuse}}};globalThis.__changeReviewWallet=next=>{address=next;accounts=[account()];listeners.forEach(f=>f({accounts}))};window.addEventListener('wallet-standard:app-ready',event=>event.detail.register(wallet));window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet',{detail:api=>api.register(wallet)}));localStorage.setItem('sui-dapp-kit:wallet-connection-info',JSON.stringify({state:{lastConnectedWalletName:wallet.name,lastConnectedAccountAddress:address},version:0}))}`
  const close = async () => {
    if(closed) throw Error('BROWSER_ALREADY_CLOSED'); closed=true
    let walletSigns: number | null = null
    try { if(cdp && primary) walletSigns=(await cdp.call('Runtime.evaluate',{expression:'globalThis.__walletSigns',returnByValue:true},primary)).result.value ?? null } catch { /* retain unknown if Chrome failed before observation */ }
    await cdp?.close(); await vite?.close()
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    const cleanup={ chromeExited: !chrome || chrome.exitCode !== null || chrome.signalCode !== null,
      serverClosed: !vite?.httpServer?.listening, profileDeleted: !profile || !existsSync(profile) }
    const directory=resolve(artifactRoot,'browser-evidence');await mkdir(directory,{recursive:true})
    await writeFile(join(directory,(profile?basename(profile):'startup-failed-'+randomUUID())+'.json'),JSON.stringify({scope:'actual Maker Product page/AppProviders/WalletProvider + controlled public WalletStandard and test-only compiled installation; real Product Host and source/receipt proof, no standalone UI root; production Maker and Foundation catalogs remain empty',canonicalRoot:root,actualIndex:resolve(root,'web/index.html'),actualAppProviders:resolve(root,'web/components/providers/app-providers.tsx'),actualPageGlob:resolve(root,'web/app'),overlayLoads:overlay.loads,sourceTuple:overlay.sourceTuple,rootMode:overlay.mode,origin:observedOrigin,downloads,requests,rawExchanges,transcript,controlledModules:{bootstrap,bridge,capability,walletBootstrap},walletSigns,runtimeExceptions,consoleErrors,cleanup,notMainnetAcceptance:true},null,2)+'\n',{flag:'wx'})
    if(runtimeExceptions.length)throw Error('UNEXPECTED_BROWSER_RUNTIME_EXCEPTION '+JSON.stringify(runtimeExceptions))
    return cleanup
  }
  try {
    profile = await mkdtemp(join(tmpdir(), 'maker-income-entry-full-spa-'))
    const config = (await import(pathToFileURL(resolve(root, 'web/postcss.config.mjs')).href)).default
    if (Object.keys(config.plugins).join() !== '@tailwindcss/postcss') throw Error('ACTUAL_POSTCSS_CONFIG_REQUIRED')
    const require = createRequire(resolve(root, 'web/package.json')), module = require('@tailwindcss/postcss'), tailwind = module.default ?? module
    const wasm = JSON.parse(await readFile(resolve(root, 'web/node_modules/@mysten/walrus-wasm/package.json'), 'utf8'))
    const allowed: Record<string, string[]> = { core: ['getChainIdentifier', 'getMoveFunction', 'listOwnedObjects'], ledgerService: ['getObject', 'getServiceInfo', 'getTransaction', 'getCheckpoint', 'getEpoch'], transactionExecutionService: ['simulateTransaction'] }
    vite = await createServer({ configFile: resolve(root, 'web/vite.config.ts'), configLoader:'runner', cacheDir: join(profile, 'vite-cache'),
      define: { 'process.env': JSON.stringify({ NODE_ENV: 'development', NEXT_PUBLIC_WALRUS_WASM_VERSION: wasm.version }) },
      css: { postcss: { plugins: [tailwind({ ...config.plugins['@tailwindcss/postcss'], base: resolve(root, 'web') })] } },
      server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error', plugins: [overlay.plugin, { name: 'maker-income-controlled-rpc-only', enforce: 'pre',
        resolveId:{order:'pre',handler(source) { if (source.endsWith('/income-withdrawal-original-client')) return '\0maker-income-original-client'; if (source.endsWith('/configured-maker-product-income')) return '\0maker-income-resume-capability' }},
        load(id) { if (id === '\0maker-income-original-client') return 'export function createIncomeWithdrawalOriginalClient(signal){return globalThis.__makeIncomeClient(signal)}'; if(id==='\0maker-income-resume-capability')return capability },
        configureServer(server) { server.middlewares.use(async (request, response, next) => {
          const url = request.url ?? ''
          if (url === '/__maker-income_bridge.ts') { response.setHeader('content-type', 'text/javascript'); response.end(await server.transformRequest('/@id/__x00__maker-income-bridge').then(result => result?.code ?? bridge)); return }
          if (!url.startsWith('/__income_rpc/')) return next()
          let body = ''
          const endJson=(value:any)=>{const bytes=JSON.stringify(value);rawExchanges.push({request:body,response:bytes});response.setHeader('content-type','application/json');response.end(bytes)}
          try {
            const mode = url.slice('/__income_rpc/'.length)
            for await (const chunk of request) { body += chunk; if (body.length > 1000000) throw Error('REQUEST_BOUND') }
            const value = JSON.parse(body), params = unwire(value.params), credential = Boolean(request.headers.cookie || request.headers.authorization)
            requests.push({ service: value.service, method: value.method, mode, digest: params.digest, credential, bytes: value.method==='simulateTransaction'?Buffer.from(params.transaction.bcs.value).toString('base64'):undefined })
            if (request.method !== 'POST' || credential || !allowed[value.service]?.includes(value.method)) throw Error('READONLY_OR_SIMULATION_ONLY')
            if (value.method === 'getTransaction' && mode !== 'confirmed' && mode !== 'pending') { endJson({ error: { code: 'NOT_FOUND', message: 'controlled original not found' } }); return }
            let result: any
            if (value.service === 'ledgerService' && value.method === 'getObject' && params.version !== undefined) result = { response: { object: x.allRows.get(`${params.objectId}:${params.version}`) } }
            else if (value.service === 'ledgerService' && value.method === 'getObject' && mode === 'confirmed' && x.allRows.has(`${params.objectId}:10`)) result = { response: { object: x.allRows.get(`${params.objectId}:10`) } }
            else if(value.service==='ledgerService'&&value.method==='getTransaction')result={response:{transaction:structuredClone(x.f.ledger)}}
            else result = await (x.client as any)[value.service][value.method](params)
            if (value.method === 'getTransaction' && mode === 'pending') { result = structuredClone(result); delete result.response.transaction.checkpoint }
            endJson({ result: wire(result) })
          } catch (error) { endJson({ error: { code: (error as any)?.code, message: error instanceof Error ? error.message : String(error) } }) }
        }) },
      }, { name: 'maker-income-actual-module-bridge', resolveId(source) { if (source === '\0maker-income-bridge' || source === '/@id/__x00__maker-income-bridge') return '\0maker-income-bridge' }, load(id) { if (id === '\0maker-income-bridge') return bridge } }] })
    await vite.listen(); const address = vite.httpServer!.address(); if (!address || typeof address === 'string') throw Error('LOOPBACK_REQUIRED')
    const origin = `http://127.0.0.1:${address.port}`;observedOrigin=origin
    const releaseGate=process.env.COMMERCE_BROWSER_READY_GATE?resolve(process.env.COMMERCE_BROWSER_READY_GATE,basename(profile!)+'.allow'):null
    const ready={releaseGate,rootMode:overlay.mode,sourceTuple:overlay.sourceTuple,kind:'COMMERCE_CURRENT_ROOT_BROWSER_READY',origin,canonicalRoot:root,actualIndex:resolve(root,'web/index.html'),actualAppProviders:resolve(root,'web/components/providers/app-providers.tsx'),actualPageGlob:resolve(root,'web/app'),overlays:overlay.overlayFiles,profile,controlledBoundary:'readonly RPC + one checked simulation; explicit test source/model factories; actual SPA/Providers/pages; no signer'}
    const readyDir=resolve(artifactRoot,'browser-evidence');await mkdir(readyDir,{recursive:true})
    await writeFile(join(readyDir,basename(profile!)+'-ready.json'),JSON.stringify(ready,null,2)+'\n',{flag:'wx'})
    process.stdout.write('COMMERCE_BROWSER_READY '+JSON.stringify({origin,profile,releaseGate,readyArtifact:join(readyDir,basename(profile!)+'-ready.json')})+'\n')
    const gate=releaseGate
    if(gate){if(!resolve(gate).startsWith(artifactRoot+'/'))throw Error('TEST_GATE_MUST_BE_IN_OWN_ARTIFACT_ROOT');let released=false;for(let i=0;i<600;i++){if(existsSync(gate)){released=true;break}await new Promise(resolve=>setTimeout(resolve,100))}if(!released)throw Error('BROWSER_ORCHESTRATOR_GATE_NOT_RELEASED')}
    const executable = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
    if (!executable) throw Error('REAL_CHROME_REQUIRED')
    chrome = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--no-pings',
      '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
      '--remote-debugging-pipe', `--user-data-dir=${profile}`,'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
    chrome.stdio[4]!.on('data',(chunk:Buffer)=>{eventBytes=Buffer.concat([eventBytes,chunk]);for(;;){const end=eventBytes.indexOf(0);if(end<0)break;const raw=eventBytes.subarray(0,end).toString();eventBytes=eventBytes.subarray(end+1);transcript.push({direction:'received',wire:raw});let value:any;try{value=JSON.parse(raw)}catch{continue}if(value.method==='Runtime.exceptionThrown')runtimeExceptions.push({session:value.sessionId,text:String(value.params.exceptionDetails.exception?.description??value.params.exceptionDetails.text).slice(0,2048)});if(value.method==='Runtime.consoleAPICalled'&&value.params.type==='error')consoleErrors.push({session:value.sessionId,text:value.params.args.map((x:any)=>String(x.value??x.description??x.type)).join(' ').slice(0,2048)})}})
    // Observe only this owned Chrome pipe, including startup/close commands.
    // The bound original write receives the same chunk and arguments unchanged.
    const commandPipe=chrome.stdio[3] as import('node:stream').Duplex,write=commandPipe.write.bind(commandPipe)
    commandPipe.write=((chunk:any,...args:any[])=>{transcript.push({direction:'sent',wire:Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk)});return(write as any)(chunk,...args)})as typeof commandPipe.write
    cdp=chromeCdp(chrome, 'maker-income-entry-full-spa', 30000);await cdp.ready()
    async function expression<T = any>(code: string, session = primary): Promise<T> {
      const result = await cdp!.call('Runtime.evaluate', { expression: code, awaitPromise: true, returnByValue: true }, session)
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      return result.result.value as T
    }
    const run = <T>(fn: (input: any) => T | Promise<T>, value: any = {}, session = primary): Promise<T> => expression(`(${fn.toString()})(${JSON.stringify(value)})`, session)
    async function wait(text: string, session = primary) { for (let i = 0; i < 600; i++) { if (await run(({ text }) => document.body?.textContent?.includes(text), { text }, session)) return; await new Promise(resolve => setTimeout(resolve, 30)) } throw Error('BROWSER_EXPECTED ' + text + ' ' + await run(() => document.body?.textContent, {}, session)) }
    async function tab() {
      const target = await cdp!.call('Target.createTarget', { url: 'about:blank' }), session = (await cdp!.call('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId
      await cdp!.call('Page.enable', {}, session); await cdp!.call('Runtime.enable', {}, session); await cdp!.call('Page.addScriptToEvaluateOnNewDocument', { source: bootstrap + walletBootstrap }, session)
      await cdp!.call('Page.navigate', { url: origin + '/income/maker' }, session); await wait('Maker／Pack Product 收益', session)
      return session
    }
    primary = await tab()
    const encoded = wire({selection:x.selection,draft:x.draft,actor:x.actor})
    async function bridgeReady(session = primary) { await expression(`import('/__maker-income_bridge.ts').then(module=>{globalThis.__incomeBridge=module;return true})`, session) }
    return { run, expression, wait, requests, primary, encoded,
      async seed(session = primary) { await bridgeReady(session); return run(({ encoded }) => (globalThis as any).__incomeBridge.seed(encoded), { encoded }, session) },
      async secondary() { secondary ||= await tab(); await bridgeReady(secondary); return secondary },
      async reload(session = primary, expected = 'Maker／Pack Product 收益') { const previous = await run(() => (globalThis as any).__documentIdentity, {}, session); await cdp!.call('Page.reload', { ignoreCache: true }, session); for (let i = 0; i < 300; i++) { await new Promise(resolve => setTimeout(resolve, 30)); if (await run(() => (globalThis as any).__documentIdentity, {}, session) !== previous) { await wait(expected, session); return } } throw Error('COLD_DOCUMENT_REQUIRED') },
      async download(session = primary) {
        const name = await run(() => document.querySelector('[aria-label="原提款恢复文件"] a[download], [aria-label="先处理原提款"] a[download], [aria-label="选定 Product 原件"] a[download]')?.getAttribute('download'), {}, session)
        if (!name || !/^maker-product-income-[A-Za-z0-9]+\.json$/.test(name)) throw Error('ORIGINAL_DOWNLOAD_REQUIRED')
        const directory = join(profile!, 'downloads', randomUUID()); await mkdir(directory, { recursive: true }); await cdp!.call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory })
        await run(() => (document.querySelector('[aria-label="原提款恢复文件"] a[download], [aria-label="先处理原提款"] a[download], [aria-label="选定 Product 原件"] a[download]') as HTMLAnchorElement).click(), {}, session)
        for (let i = 0; i < 200; i++) { const file = join(directory, name); if (existsSync(file)){const text=await readFile(file,'utf8');downloads.push({name,directory,sha256:createHash('sha256').update(text).digest('hex'),text});return text} await new Promise(resolve => setTimeout(resolve, 25)) }
        throw Error('BROWSER_DOWNLOAD_TIMEOUT')
      },
      async downloadExecutionFacts(session=primary){
        const name=await run(()=>document.querySelector('[aria-label="原交易执行事实"] a[download]')?.getAttribute('download'),{},session)
        if(!name||!/^income-original-execution-[A-Za-z0-9]+\.json$/.test(name))throw Error('EXECUTION_FACTS_DOWNLOAD_REQUIRED')
        const directory=join(profile!,'downloads',randomUUID());await mkdir(directory,{recursive:true});await cdp!.call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:directory})
        await run(()=>(document.querySelector('[aria-label="原交易执行事实"] a[download]')as HTMLAnchorElement).click(),{},session)
        for(let i=0;i<200;i++){const file=join(directory,name);if(existsSync(file)){const text=await readFile(file,'utf8');downloads.push({name,directory,sha256:createHash('sha256').update(text).digest('hex'),text});return text}await new Promise(resolve=>setTimeout(resolve,25))}
        throw Error('EXECUTION_FACTS_NATIVE_DOWNLOAD_TIMEOUT')
      }, close }
  } catch (error) { if(!closed)await close(); throw error }
}
