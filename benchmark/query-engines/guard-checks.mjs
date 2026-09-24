import ivm from 'isolated-vm';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
const isolate=new ivm.Isolate({memoryLimit:64});
const context=isolate.createContextSync();
const result={globals:JSON.parse(context.evalSync('JSON.stringify({require:typeof require,process:typeof process,fetch:typeof fetch,TextEncoder:typeof TextEncoder,TextDecoder:typeof TextDecoder})'))};
try{
 assert.equal(result.globals.require,'undefined');assert.equal(result.globals.process,'undefined');assert.equal(result.globals.fetch,'undefined');
 assert.throws(()=>context.evalSync("import x from 'node:fs'"),/Cannot use import/);
 for(const [name,code] of [['dynamic',"import('node:fs')"],['generated',"Function(\"return import('node:fs')\")()"]]){
  context.evalSync(`globalThis.status='pending';${code}.then(()=>status='ALLOWED',e=>status=e.message);void 0;`);
  result[name]=context.evalSync('status');assert.equal(result[name],'Not supported');
 }
 const start=performance.now();assert.throws(()=>context.evalSync('while(true){}',{timeout:100}),/timed out/);result.timeoutMs=performance.now()-start;
 assert.equal(context.evalSync('1+2'),3);result.afterTimeout=3;
 writeFileSync('guard-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{isolate.dispose()}
