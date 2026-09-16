const views=new Set(['overview','documents','recreation','assets','tasks','delivery'])

export function parseRoute(hash){const match=/^#\/projects\/([^/]+)\/([^/?]+)/.exec(hash);if(!match)return null;try{return{projectKey:decodeURIComponent(match[1]),view:views.has(match[2])?match[2]:'overview'}}catch{return null}}
export const projectRoute=(projectKey,view='overview')=>`#/projects/${encodeURIComponent(projectKey)}/${views.has(view)?view:'overview'}`
export const marketRoute=()=> '#/market'
export function parseAppRoute(hash){if(hash==='#/market')return{kind:'market'};const project=parseRoute(hash);return project?{kind:'project',...project}:{kind:'home'}}
