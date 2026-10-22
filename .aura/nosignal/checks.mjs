// Only run inside the no-network ephemeral validation container.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, openSync, readFileSync, closeSync } from 'node:fs';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
const common={...process.env,HOME:'/tmp/aura-home',SHOTS_DIR:'/tmp/shots',NPM_CONFIG_IGNORE_SCRIPTS:'true',NPM_CONFIG_AUDIT:'false',NPM_CONFIG_FUND:'false',NPM_CONFIG_UPDATE_NOTIFIER:'false',npm_config_nodedir:'/usr/local'};
mkdirSync(common.HOME,{recursive:true});
const run=(args,env=common,timeout=180000)=>{console.log('AURA_CHECK',args.join(' '));const r=spawnSync(args[0],args.slice(1),{cwd:'/work',env,stdio:'inherit',timeout,killSignal:'SIGKILL'});if(r.error||r.status!==0)throw Error(`Check failed: ${args[0]} ${args[1]} (${r.status??r.error?.code})`);};
run(['npm','rebuild','argon2','better-sqlite3','--offline','--build-from-source','--ignore-scripts=false','--nodedir=/usr/local'],common,180000);
run(['npm','run','build'],common,180000);
const security=readdirSync('/work/tests/security').filter(n=>n.endsWith('.test.mjs')).sort().map(n=>'tests/security/'+n);
if(!security.length)throw Error('No security tests');
run(['node','--test',...security],common,180000);
const ready=()=>new Promise(resolve=>{const r=https.get('https://127.0.0.1:3068/',{rejectUnauthorized:false,timeout:1000},res=>{res.resume();resolve(res.statusCode===200);});r.on('error',()=>resolve(false));r.on('timeout',()=>r.destroy());});
for(const [i,test] of ['tests/backup/kb1-e2e.mjs','tests/groups-web/gr2-e2e.mjs','tests/web-e2e/media-e2e.mjs'].entries()){
 const data=`/tmp/app-${i}`,log=`/tmp/app-${i}.log`;mkdirSync(data,{recursive:true});
 const env={...common,NODE_ENV:'production',TLS_MODE:'auto',TLS_HOSTS:'127.0.0.1',BIND_HOST:'127.0.0.1',PORT:'3068',TRUSTED_ORIGINS:'https://127.0.0.1:3068',DATA_DIR:data,OPEN_REGISTRATION:'1',WEBAUTHN_RP_ID:'127.0.0.1',CHANNEL_ACTIVE_KEY_ID:'ci',CHANNEL_KEYRING:'ci:'+randomBytes(32).toString('base64url'),SESSION_SECRET:randomBytes(32).toString('hex'),BASE:'https://127.0.0.1:3068'};
 const fd=openSync(log,'w');const server=spawn('node',['apps/server/dist/index.js'],{cwd:'/work',env,stdio:['ignore',fd,fd]});closeSync(fd);
 try{let ok=false;for(let n=0;n<45;n++){if(await ready()){ok=true;break;}if(server.exitCode!==null)break;await new Promise(r=>setTimeout(r,500));}if(!ok)throw Error('Ephemeral app did not start');run(['node',test],env,210000);}
 catch(e){console.error(readFileSync(log,'utf8').slice(-12000));throw e;}
 finally{server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),new Promise(r=>setTimeout(r,2000))]);server.kill('SIGKILL');rmSync(data,{recursive:true,force:true});}
}
console.log('AURA_NOSIGNAL_ALL_CHECKS_PASSED');
