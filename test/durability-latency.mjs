import process from 'node:process'
import test from 'node:test'
import assert from 'node:assert/strict'
import {performance} from 'node:perf_hooks'
import {execFileSync} from 'node:child_process'
import {makeServerFixture,getOpenPort,startServer,waitForServer,postCommand,getCommandStatus} from './durability-helpers.mjs'

test('measure local startup, acceptance, and completion latency',async t=>{
    const store=await makeServerFixture(t),port=await getOpenPort()
    const boot=performance.now(),server=startServer(t,store,{port})
    await waitForServer(server.child,server.getOutput,port)
    const startupMs=performance.now()-boot,accepted=[],completed=[]
    for(let i=0;i<30;i++){
        const start=performance.now(),id=`latency-${i}`
        assert.equal((await postCommand(port,{id,name:'addPerson',value:{name:id}})).status,202)
        accepted.push(performance.now()-start)
        for(;;){ const status=await getCommandStatus(port,id);if(status.status==='done'){ break; }assert.equal(['accepted','active'].includes(status.status),true);await new Promise(r=>setTimeout(r,2)) }
        completed.push(performance.now()-start)
    }
    const stats=values=>{ const v=[...values].sort((a,b)=>a-b);return {p50Ms:v[Math.floor(v.length*.5)],p95Ms:v[Math.floor(v.length*.95)],maxMs:v.at(-1)} }
    t.diagnostic(JSON.stringify({samples:30,startupMs,acceptance:stats(accepted),completion:stats(completed),filesystem:execFileSync('stat',['-f','-c','%T',store.dir],{encoding:'utf8'}).trim(),node:process.version,notes:'Single localhost client; completion includes a fresh worker and polling; no production performance claim'}))
})
