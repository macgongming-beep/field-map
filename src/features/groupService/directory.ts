export const GROUP_DIRECTORY_KEY='service_group_directory'
export const GROUP_DIRECTORY_CHANGED='service-group-directory-changed'
export type ServiceGroup={code:string;name:string;active:boolean}
export type GroupDirectory={revision:string;groups:ServiceGroup[]}
export function parseGroupDirectory(value:string|undefined|null):GroupDirectory|null {
  if(value==null)return null
  try{
    const parsed=JSON.parse(value) as GroupDirectory
    if(!/^\d+$/.test(parsed.revision)||!Array.isArray(parsed.groups))return null
    if(parsed.groups.some(g=>!g||typeof g.code!=='string'||!g.code||typeof g.name!=='string'||!g.name||typeof g.active!=='boolean'))return null
    if(new Set(parsed.groups.map(g=>g.code)).size!==parsed.groups.length)return null
    return parsed
  }catch{return null}
}
export function directorySettings(directory:GroupDirectory):Record<string,string>{
  return {[GROUP_DIRECTORY_KEY]:JSON.stringify(directory),user_groups:JSON.stringify(directory.groups.filter(g=>g.active).map(g=>g.name))}
}
export function mergeDirectorySettings(previous:Record<string,string>,incoming:Record<string,string>){
  const before=parseGroupDirectory(previous[GROUP_DIRECTORY_KEY]),next=parseGroupDirectory(incoming[GROUP_DIRECTORY_KEY])
  return before&&(!next||BigInt(before.revision)>BigInt(next.revision))?{...incoming,...directorySettings(before)}:incoming
}
