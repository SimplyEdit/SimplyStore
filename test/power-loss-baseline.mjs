import {Buffer} from 'node:buffer'
// The original baseline is retained at EVD-20260919-TTZ7C-23's Git version.
// These assertions implement the corrected command-only / authoritative-log contracts.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import JSONTag from '@muze-nl/jsontag'
import {fixture,launch,submit,completion,eventually,rows,crash,copyImage,loseUnpublishedName} from './power-loss-helpers.mjs'
import {getOpenPort,waitForServer,waitForExit,queryPersons,readCommandLogRecords,readCommandStatusRecords,unlockStoppedFixture} from './durability-helpers.mjs'
import {inspectStore} from '../src/store-inspection.mjs'

async function ready(t,store,options={}) {
    const port=await getOpenPort(), server=await launch(t,store,port,options)
    await waitForServer(server.child,server.getOutput,port)
    return {...server,port}
}
const command=id=>({id,name:'addPerson',value:{name:id}})
async function commit(store,server,id='A') {
    assert.equal((await submit(store,server.port,command(id))).http,202)
    assert.equal((await completion(store,server.port,id)).status,'done')
}

test('PL01-05 durable publication survives modeled loss of unsynced names and restart',async t=>{
    const store=await fixture(t),server=await ready(t,store)
    await commit(store,server)
    const trace=await rows(store.trace)
    const changeset=path.join(store.dir,'data.A.jsontag')
    const rename=trace.findIndex(e=>e.op==='rename'&&e.file===changeset)
    assert.ok(rename>0)
    assert.ok(trace.slice(0,rename).some(e=>e.op==='sync'&&e.file===trace[rename].from))
    const dirSync=trace.findIndex((e,i)=>i>rename&&e.op==='sync'&&e.file===store.dir)
    const doneSync=trace.findIndex((e,i)=>i>dirSync&&e.op==='datasync'&&e.file===store.commandStatus&&Buffer.from(e.bytes,'base64').toString().includes('"status":"done"'))
    assert.ok(dirSync>rename&&doneSync>dirSync)
    await crash(server.child)
    const image=await copyImage(t,store)
    assert.equal(await loseUnpublishedName(store,image,changeset),false)
    await unlockStoppedFixture(t,image)
    const restarted=await ready(t,image)
    assert.deepEqual((await queryPersons(restarted.port)).map(p=>p.name),['A'])
})

test('PL10 an actual short changeset write is completed before acknowledgment',async t=>{
    const store=await fixture(t),server=await ready(t,store,{fault:{op:'write',file:'data.A.jsontag.',action:'short-write'}})
    await commit(store,server)
    const trace=await rows(store.trace)
    assert.ok(trace.some(e=>e.op==='injected'&&e.action==='short-write'))
    assert.ok(trace.filter(e=>e.op==='write'&&path.basename(e.file).startsWith('data.A.jsontag.')).length>=2)
    assert.deepEqual((await inspectStore(store)).data.persons.map(p=>p.name),['A'])
})
for (const [name,op,file,contains] of [
    ['log sync','datasync','command-log.jsontag','"id":"A"'],
    ['acceptance sync','datasync','command-status.jsontag','"status":"accepted"'],
    ['log close','close:after','command-log.jsontag','"id":"A"'],
    ['changeset sync','sync','data.A.jsontag.'],
    ['changeset rename','rename','data.A.jsontag'],
    ['done sync','datasync','command-status.jsontag','"status":"done"']
]) {
    test(`PL07-09/11/18-20 ${name} failure stops mutation without false terminal success`,async t=>{
        const store=await fixture(t),server=await ready(t,store,{fault:{op,file,contains,action:'error'}})
        try {
            await submit(store,server.port,command('A'))
        }
        catch(error){
            assert.match(error.message,/fetch failed|terminated|socket/)
        }
        assert.equal((await waitForExit(server.child)).code,1)
        assert.match(server.getOutput(),/Storage outcome uncertain/)
        assert.ok((await rows(store.trace)).some(e=>e.op==='injected'))
        const status=await readCommandStatusRecords(store)
        // Failed sync can leave a complete but uncertain done record; never append failed after it.
        const done=status.findIndex(s=>s.status==='done')
        if(done>=0){
            assert.equal(status.slice(done+1).some(s=>s.status==='failed'),false)
        }
        else {
            assert.equal(status.some(s=>s.status==='done'),false)
        }
    })
}
test('PL15 configured workers cannot receive HTTP execution inputs; command values roundtrip',async t=>{
    const store=await fixture(t,{commandsSource:`export default {addPerson(data,command,request,meta){
        if(request!==undefined)throw new Error('unlogged input leaked')
        if(!meta.index.id)throw new Error('index unavailable')
        data.persons.push(command.value)
    }}`})
    const worker=path.join(store.dir,'custom-worker.mjs')
    await fs.writeFile(worker,`import {parentPort} from 'node:worker_threads'
import runCommand,{initialize} from ${JSON.stringify(new URL('../src/command-worker-module.mjs',import.meta.url).href)}
parentPort.on('message',async task=>{if('request' in task)throw new Error('request leaked to worker');await initialize(task);parentPort.postMessage(await runCommand(task.command,{query:{name:'wrong'}}))})`)
    const server=await ready(t,store,{server:{commandWorker:worker}})
    const input={id:'A',name:'addPerson',value:{name:'café 漢字 😀',date:new Date('2026-09-19T00:00:00Z')}}
    assert.equal((await submit(store,server.port,input,'?name=wrong')).http,202)
    assert.equal((await completion(store,server.port,'A')).status,'done')
    assert.equal(JSONTag.stringify((await readCommandLogRecords(store))[0]),JSONTag.stringify(input))
    assert.equal((await queryPersons(server.port))[0].name,input.value.name)
})
for(const duplicate of [false,true]){
    test(`PL16 delayed append cannot be overtaken${duplicate?' by duplicate ID':''}`,async t=>{
        const store=await fixture(t),server=await ready(t,store,{fault:{op:'datasync:after',file:'command-log.jsontag',contains:'"id":"A"',action:'pause'}})
        const a=submit(store,server.port,command('A'))
        await eventually(async()=> (await rows(store.trace)).some(e=>e.op==='injected'),'A append gate')
        const b=submit(store,server.port,command(duplicate?'A':'B'))
        await new Promise(resolve=>setTimeout(resolve,30))
        assert.deepEqual((await readCommandLogRecords(store)).map(c=>c.id),['A'])
        await fs.writeFile(store.release,'')
        assert.equal((await a).http,202);assert.ok([200,202].includes((await b).http))
        await completion(store,server.port,duplicate?'A':'B')
        const expected=duplicate?['A']:['A','B']
        assert.deepEqual((await readCommandLogRecords(store)).map(c=>c.id),expected)
        assert.deepEqual((await readCommandStatusRecords(store)).filter(s=>s.status==='active').map(s=>s.command),expected)
        assert.deepEqual((await queryPersons(server.port)).map(p=>p.name),expected)
    })
}
for(const artifact of ['command-log.jsontag','command-status.jsontag','data.A.jsontag']){
    test(`PL02-04/06 missing ${artifact} fails open rather than recreating history`,async t=>{
        const store=await fixture(t),server=await ready(t,store);await commit(store,server)
        await crash(server.child);await unlockStoppedFixture(t,store)
        await fs.unlink(path.join(store.dir,artifact))
        const before=await fs.readdir(store.dir)
        const restarted=await launch(t,store,await getOpenPort())
        assert.equal((await waitForExit(restarted.child)).code,1)
        assert.match(restarted.getOutput(),/Administrative recovery required/)
        assert.deepEqual((await fs.readdir(store.dir)).sort(),before.sort())
    })
}
test('PL12/17 startup preserves uncertain active work without repeating external effects',async t=>{
    const store=await fixture(t,{commandsSource:`import fs from 'node:fs'; export default {addPerson(data,command){fs.appendFileSync(${JSON.stringify('/tmp/placeholder-effect')},'') ;data.persons.push(command.value)}}`})
    const witness=path.join(store.audit,'effects')
    await fs.writeFile(store.commandsFile,`import fs from 'node:fs'; export default {addPerson(data,command){fs.appendFileSync(${JSON.stringify(witness)},command.id+'\\n');data.persons.push(command.value)}}`)
    const server=await ready(t,store,{fault:{op:'write',file:'command-status.jsontag',contains:'"status":"done"',action:'error'}})
    await submit(store,server.port,command('A'));await waitForExit(server.child).catch(error=>{
        throw new Error(server.getOutput(),{cause:error})
    })
    const before=await fs.readFile(store.commandStatus)
    await unlockStoppedFixture(t,store)
    const restarted=await launch(t,store,await getOpenPort())
    assert.equal((await waitForExit(restarted.child)).code,1)
    assert.deepEqual(await fs.readFile(store.commandStatus),before)
    assert.equal(await fs.readFile(witness,'utf8'),'A\n')
})

for(const operation of ['sync','close:after']){
    test(`directory ${operation} failure after rename prevents done`,async t=>{
        const store=await fixture(t)
        const server=await ready(t,store,{fault:{op:operation,file:path.basename(store.dir),action:'error',after:{op:'rename',file:'data.A.jsontag'}}})
        await submit(store,server.port,command('A'))
        assert.equal((await waitForExit(server.child)).code,1)
        assert.ok((await rows(store.trace)).some(e=>e.op==='injected'&&e.file===store.dir))
        assert.equal((await readCommandStatusRecords(store)).some(c=>c.status==='done'),false)
    })
}
for(const operation of ['open','write','close:after']){
    test(`changeset ${operation} error is not masked or acknowledged`,async t=>{
        const store=await fixture(t)
        const server=await ready(t,store,{fault:{op:operation,file:'data.A.jsontag.',action:'error',code:operation==='write'?'ENOSPC':'EIO'}})
        await submit(store,server.port,command('A'))
        assert.equal((await waitForExit(server.child)).code,1)
        assert.equal((await readCommandStatusRecords(store)).some(c=>c.status==='done'),false)
        assert.match(server.getOutput(),/Storage outcome uncertain/)
    })
}
test('short command-log append preserves its entire JSONTag record',async t=>{
    const store=await fixture(t)
    const server=await ready(t,store,{fault:{op:'write',file:'command-log.jsontag',contains:'"id":"A"',action:'short-write'}})
    await commit(store,server)
    assert.deepEqual((await readCommandLogRecords(store))[0],command('A'))
    assert.ok((await rows(store.trace)).some(e=>e.op==='injected'))
})
