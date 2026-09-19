import process from 'node:process'
import fs from 'node:fs/promises'
import JSONTag from '@muze-nl/jsontag'
import serialize from '@muze-nl/od-jsontag/src/serialize.mjs'
import server from './src/server.mjs'
import {publishFile} from './src/storage.mjs'
import {inspectStore} from './src/store-inspection.mjs'
const mode=(await fs.readFile('/proc/cmdline','utf8')).match(/scenario=(\w+)/)?.[1] || 'done'
const config={datafile:'/store/data.jsontag',commandLog:'/store/command-log.jsontag',commandStatus:'/store/command-status.jsontag',commandsFile:'/app/commands.mjs',indexFile:'/app/index.mjs'}
console.log('ENVELOPE '+JSON.stringify({kernel:await fs.readFile('/proc/version','utf8'),mounts:await fs.readFile('/proc/mounts','utf8'),writeCache:await fs.readFile('/sys/block/vda/queue/write_cache','utf8')}))
const exists=await fs.access(config.datafile).then(()=>true,()=>false)
if(exists){
 const report=await inspectStore(config)
 console.log('VERIFY '+JSON.stringify({ready:report.ready,errors:report.errors,commands:report.commands.map(c=>({id:c.id,status:c.status,present:c.present})),persons:report.data?.persons,unsyncedPresent:await fs.access('/store/unsynced').then(()=>true,()=>false)}))
 process.exit(0)
}
await publishFile(config.datafile,serialize(JSONTag.parse('{"persons":[]}')))
await publishFile(config.commandLog,'');await publishFile(config.commandStatus,'')
if(mode==='unsynced'){await fs.writeFile('/store/unsynced','not guaranteed durable');console.log('CUT_UNSYNCED');await new Promise(()=>{})}
await fs.writeFile('/app/commands.mjs',`export default {addPerson(data,command){${mode==='active'?"console.log('CUT_ACTIVE');while(true){}":mode==='accepted'?"while(true){}":"data.persons.push(command.value)"}}}`)
await fs.writeFile('/app/index.mjs','export default {update(){},create(){},load(){return {}}}')
await server.run({...config,port:3000,maxWorkers:1,commandTimeout:0,wwwroot:'/app/www'})
await new Promise(r=>setTimeout(r,100))
const before=performance.now()
const response=await fetch('http://127.0.0.1:3000/command',{method:'POST',headers:{'content-type':'application/jsontag'},body:JSONTag.stringify({id:'A',name:'addPerson',value:{name:'A'}})})
console.log('ACCEPTED '+JSON.stringify({http:response.status,ms:performance.now()-before}))
if(mode==='accepted')console.log('CUT_ACCEPTED')
if(mode==='done'){
 for(;;){const status=await fetch('http://127.0.0.1:3000/command/A').then(r=>r.json());if(status.status==='done')break;await new Promise(r=>setTimeout(r,10))}
 const samples=[{id:'A',doneMs:performance.now()-before}]
 for(let i=0;i<4;i++){
  const id='L'+i,start=performance.now()
  const accepted=await fetch('http://127.0.0.1:3000/command',{method:'POST',headers:{'content-type':'application/jsontag'},body:JSONTag.stringify({id,name:'addPerson',value:{name:id}})})
  if(accepted.status!==202)throw new Error('Acceptance failed')
  const acceptMs=performance.now()-start
  for(;;){const status=await fetch('http://127.0.0.1:3000/command/'+id).then(r=>r.json());if(status.status==='done')break;await new Promise(r=>setTimeout(r,10))}
  samples.push({id,acceptMs,doneMs:performance.now()-start})
 }
 console.log('CUT_DONE '+JSON.stringify({samples}))
}
await new Promise(()=>{})
