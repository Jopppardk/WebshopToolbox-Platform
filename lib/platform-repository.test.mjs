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
