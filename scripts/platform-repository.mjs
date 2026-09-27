import {spawnSync} from 'node:child_process';
export function assertPlatformRepository(){
 const remote=spawnSync('git',['remote','get-url','origin'],{encoding:'utf8'});
 if(remote.status!==0||!['https://github.com/Jopppardk/WebshopToolbox-Platform.git','git@github.com:Jopppardk/WebshopToolbox-Platform.git'].includes(remote.stdout.trim()))throw Error('Deployment kræver det separate WebshopToolbox-Platform repository.');
 const branch=spawnSync('git',['branch','--show-current'],{encoding:'utf8'}).stdout.trim();
 if(branch!=='main'&&!branch.startsWith('platform/'))throw Error('Deployment kræver main eller en platformbranch i det separate repository.');
 if(process.env.GITHUB_REPOSITORY&&process.env.GITHUB_REPOSITORY!=='Jopppardk/WebshopToolbox-Platform')throw Error('Forks må ikke deploye.');
}
