import {Buffer} from 'node:buffer'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {writeAll,publishFile,publishFileSync,appendRecord,serialWriter} from '../src/storage.mjs'

test('complete-write loop preserves bytes through repeated short writes and rejects zero progress', async()=>{
    const bytes = Buffer.from('café 漢字 😀'), written=[]
    await writeAll({async write(buffer,offset,length){ const n=Math.min(3,length);written.push(buffer.subarray(offset,offset+n));return {bytesWritten:n} }},bytes)
    assert.deepEqual(Buffer.concat(written),bytes)
    for (const count of [0,-1,NaN,1000]) { await assert.rejects(writeAll({async write(){ return {bytesWritten:count} }},bytes), /progress write/) }
})
test('serialized writer preserves order and stops after an uncertain operation',async()=>{
    const run=serialWriter(), seen=[]
    let release
    const gate=new Promise(resolve=>{ release=resolve })
    const first=run(async()=>{ seen.push('A');await gate;throw new Error('uncertain') })
    const second=run(async()=>seen.push('B'))
    release();await assert.rejects(first,/uncertain/);await assert.rejects(second,/uncertain/)
    assert.deepEqual(seen,['A'])
})
test('durable publication replaces entire contents and concurrent append retains each record once',async t=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'simplystore-storage-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}))
    const file=path.join(dir,'data')
    publishFileSync(file,'old')
    await publishFile(file,'new café');assert.equal(await fs.readFile(file,'utf8'),'new café')
    await publishFile(file,'');assert.equal((await fs.stat(file)).size,0)
    await Promise.all(Array.from({length:40},(_,i)=>appendRecord(file,String(i))))
    assert.equal(await fs.readFile(file,'utf8'),Array.from({length:40},(_,i)=>i+'\n').join(''))
    await assert.rejects(publishFile(path.join(dir,'missing','x'),'x'),error=>error.code==='ENOENT' && error.storageFailure)
    assert.deepEqual((await fs.readdir(dir)).sort(),['data'])
})
