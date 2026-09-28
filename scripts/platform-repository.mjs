import {spawnSync} from 'node:child_process';
export function isPlatformRemote(remote){
 return ['https://github.com/Jopppardk/WebshopToolbox-Platform','https://github.com/Jopppardk/WebshopToolbox-Platform.git','git@github.com:Jopppardk/WebshopToolbox-Platform.git'].includes(remote.trim());
}
export function isPlatformDeployRef(branch,sha,env=process.env){
 if(env.GITHUB_ACTIONS==='true')return env.GITHUB_REPOSITORY==='Jopppardk/WebshopToolbox-Platform'&&env.GITHUB_REF==='refs/heads/main'&&/^[a-f0-9]{40}$/.test(sha)&&sha===env.GITHUB_SHA;
 return branch==='main'||branch.startsWith('platform/');
}
export function assertPlatformRepository(){
 const remote=spawnSync('git',['remote','get-url','origin'],{encoding:'utf8'});
 if(remote.status!==0||!isPlatformRemote(remote.stdout))throw Error('Deployment kræver det separate WebshopToolbox-Platform repository.');
 const branch=spawnSync('git',['branch','--show-current'],{encoding:'utf8'}).stdout.trim();
 const sha=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
 if(!isPlatformDeployRef(branch,sha))throw Error('Deployment kræver main/platformbranch lokalt eller præcis workflow-SHA fra main i GitHub Actions.');
 if(process.env.GITHUB_REPOSITORY&&process.env.GITHUB_REPOSITORY!=='Jopppardk/WebshopToolbox-Platform')throw Error('Forks må ikke deploye.');
}
