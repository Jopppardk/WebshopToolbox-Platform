import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('separate platform repository has no Sablen deployment workflow',()=>{
 assert.equal(existsSync(new URL('../.github/workflows/deploy.yml',import.meta.url)),false);
 for(const name of readdirSync(new URL('../.github/workflows/',import.meta.url))){
  for(const line of read('.github/workflows/'+name).split('\n')){
   if(line.includes('wrangler.direct.jsonc'))assert.match(line,/--dry-run/);
  }
 }
 const deployment=read('.github/workflows/platform-deploy.yml');
 assert.match(deployment,/workflow_dispatch:/);assert.doesNotMatch(deployment,/^\s+(push|pull_request):/m);
 assert.match(deployment,/github.repository == 'Jopppardk\/WebshopToolbox-Platform'/);
 assert.match(deployment,/environment: \$\{\{ inputs.target \}\}/);
 const scripts=JSON.parse(read('package.json')).scripts;
 assert.equal(scripts['deploy:cloudflare'],'node scripts/platform.mjs deploy');
 assert.equal(scripts['deploy:prod'],'node scripts/platform-production.mjs deploy');
});


test('repository guard accepts GitHub checkout origin and rejects other destinations',async()=>{
 const {isPlatformRemote}=await import('../scripts/platform-repository.mjs');
 for(const remote of ['https://github.com/Jopppardk/WebshopToolbox-Platform','https://github.com/Jopppardk/WebshopToolbox-Platform.git','git@github.com:Jopppardk/WebshopToolbox-Platform.git'])assert.equal(isPlatformRemote(remote),true);
 for(const remote of ['https://github.com/Jopppardk/WebshopToolbox','https://github.com/Jopppardk/WebshopToolbox.git','https://github.com/other/WebshopToolbox-Platform.git','https://github.com/Jopppardk/WebshopToolbox-Platform-extra.git','https://github.com.evil.test/Jopppardk/WebshopToolbox-Platform.git'])assert.equal(isPlatformRemote(remote),false);
});


test('remote dev uses its custom domain without a workers.dev alias',async()=>{
 const {validateConfig}=await import('../scripts/platform-config.mjs');
 const config=JSON.parse(read('wrangler.platform-test.json'));
 validateConfig(config,true);
 assert.equal(config.workers_dev,false);
 assert.equal(config.routes[0].pattern,'dev.webshoptoolbox.dk');
 assert.throws(()=>validateConfig({...config,workers_dev:true},true));
});
