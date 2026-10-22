// Only run inside the credential-free, egress-isolated validation container.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, openSync, readFileSync, closeSync } from 'node:fs';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
const common={...process.env,HOME:'/tmp/aura-home',SHOTS_DIR:'/tmp/shots',NPM_CONFIG_IGNORE_SCRIPTS:'true',NPM_CONFIG_AUDIT:'false',NPM_CONFIG_FUND:'false',NPM_CONFIG_UPDATE_NOTIFIER:'false',npm_config_nodedir:'/usr/local'};

const run=(args,env=common,timeout=180000)=>{console.log('AURA_CHECK',args.join(' '));const r=spawnSync(args[0],args.slice(1),{cwd:'/work',env,stdio:'inherit',timeout,killSignal:'SIGKILL'});if(r.error||r.status!==0)throw Error(`Check failed: ${args[0]} ${args[1]} (${r.status??r.error?.code})`);};
const ready=base=>new Promise(resolve=>{const r=https.get(base+'/',{rejectUnauthorized:false,timeout:1000},res=>{res.resume();resolve(res.statusCode===200);});r.on('error',()=>resolve(false));r.on('timeout',()=>r.destroy());});
// Keep diagnostic metadata across the whole run, without printing request bodies,
// headers, cookies, query strings, backup blobs, or generated account secrets.
const reportHttpFailures=log=>{
 const pending=new Map(),counts=new Map(),failures=[];
 for(const line of readFileSync(log,'utf8').split('\n')){
  let entry;try{entry=JSON.parse(line);}catch{continue;}
  if(typeof entry.reqId!=='string')continue;
  if(entry.req&&typeof entry.req.url==='string'){
   const method=String(entry.req.method||'').replace(/[^A-Z]/g,'').slice(0,12);
   let path;try{path=new URL(entry.req.url,'https://127.0.0.1').pathname;}catch{continue;}
   // Retain API route shape, never concrete user/message identifiers.
   path=path.split('/').map(part=>/^[a-z][a-z-]{0,40}$/.test(part)?part:part?'[id]':'').join('/').slice(0,200);
   pending.set(entry.reqId,{method,path});
  }
  const status=entry.res?.statusCode;
  if(!Number.isInteger(status)||status<100||status>599)continue;
  const request=pending.get(entry.reqId);pending.delete(entry.reqId);
  if(!request)continue;
  const key=`${request.method} ${request.path} ${status}`;
  counts.set(key,(counts.get(key)||0)+1);
  if(status>=400)failures.push({...request,status});
 }
 console.error('AURA_HTTP_SUMMARY',JSON.stringify({counts:[...counts.entries()].sort().slice(0,200),failures:failures.slice(-100)}));
};
export const browserCases = Object.freeze(['tests/backup/kb1-e2e.mjs','tests/groups-web/gr2-e2e.mjs','tests/web-e2e/media-e2e.mjs'].map((test,i)=>Object.freeze({test,index:i,port:3068+i})));
export async function allBrowserCases(execute) {
 const results=await Promise.allSettled(browserCases.map(execute));
 const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);
 if(errors.length)throw new AggregateError(errors,'Required browser scenarios failed');
}
const runAsync=(args,env,timeout)=>new Promise((resolve,reject)=>{
 console.log('AURA_CHECK',env.PORT,args.join(' '));
 const child=spawn(args[0],args.slice(1),{cwd:'/work',env,stdio:'inherit'});
 const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Browser scenario timed out'));},timeout);
 child.once('error',error=>{clearTimeout(timer);reject(error);});
 child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error(`Browser scenario failed: ${args[1]} (${code})`));});
});
async function browserScenario({test,index:i,port}) {
 const data=`/tmp/app-${i}`,log=`/tmp/app-${i}.log`,base=`https://127.0.0.1:${port}`;mkdirSync(data,{recursive:true});
 const env={...common,NODE_ENV:'production',TLS_MODE:'auto',TLS_HOSTS:'127.0.0.1',BIND_HOST:'127.0.0.1',PORT:String(port),TRUSTED_ORIGINS:base,DATA_DIR:data,OPEN_REGISTRATION:'1',WEBAUTHN_RP_ID:'127.0.0.1',CHANNEL_ACTIVE_KEY_ID:'ci',CHANNEL_KEYRING:'ci:'+randomBytes(32).toString('base64url'),SESSION_SECRET:randomBytes(32).toString('hex'),BASE:base};
 const fd=openSync(log,'w');const server=spawn('node',['apps/server/dist/index.js'],{cwd:'/work',env,stdio:['ignore',fd,fd]});closeSync(fd);
 try{let ok=false;for(let n=0;n<45;n++){if(await ready(base)){ok=true;break;}if(server.exitCode!==null)break;await new Promise(r=>setTimeout(r,500));}if(!ok)throw Error('Ephemeral app did not start');await runAsync(['node',test],env,210000);}
 catch(e){reportHttpFailures(log);throw e;}
 finally{server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),new Promise(r=>setTimeout(r,2000))]);server.kill('SIGKILL');rmSync(data,{recursive:true,force:true});}
}
if (process.argv[1] === '/checks.mjs') {
 mkdirSync(common.HOME,{recursive:true});
 // Measure the actual container browser before executing any repository code.
 const online=spawnSync('/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-gpu','--disable-background-networking','--no-first-run','--user-data-dir=/tmp/aura-network-check','--dump-dom','data:text/html,<body><script>document.write("AURA_ONLINE_"+navigator.onLine)</script></body>'],{env:common,encoding:'utf8',timeout:15000,maxBuffer:1048576});
 if(online.error||online.status!==0||!online.stdout.includes('>AURA_ONLINE_true<'))throw Error('Isolated browser is not online');
 console.log('AURA_BROWSER_STATE: online; egress remains isolated');
 run(['npm','rebuild','argon2','better-sqlite3','--offline','--build-from-source','--ignore-scripts=false','--nodedir=/usr/local'],common,180000);
 run(['npm','run','build'],common,180000);
 const security=readdirSync('/work/tests/security').filter(n=>n.endsWith('.test.mjs')).sort().map(n=>'tests/security/'+n);
 if(!security.length)throw Error('No security tests');
 // The upstream suite compares real password-hash timings. Run files serially
 // so unrelated CPU-heavy tests do not compete under the aggregate container CPU quota.
 // Keep every upstream assertion and test file unchanged.
 run(['node','--test','--test-concurrency=1',...security],common,180000);
 // Separate loopback ports, app state and keys; one container enforces the
 // aggregate four-CPU/6-GiB limit. Every original scenario must finish successfully.
 await allBrowserCases(browserScenario);
 console.log('AURA_NOSIGNAL_ALL_CHECKS_PASSED');
}
