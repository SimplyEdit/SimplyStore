import {build} from '/home/auke/git/slonl/spiral/od-jsontag/node_modules/esbuild/lib/main.js';
import {readFileSync,writeFileSync,openSync,closeSync,readSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {cpus} from 'node:os';
import assert from 'node:assert/strict';
const repo='/home/auke/git/slonl/spiral/od-jsontag';
const engine=process.argv[2]||'ivm';
const clock=()=>performance.now();
const loadStart=clock();
const ivm=engine==='ivm'?(await import('isolated-vm')).default:null;
const QuickJS=engine==='quickjs'?await (await import(repo+'/node_modules/quickjs-emscripten/dist/index.mjs')).getQuickJS():null;
const moduleLoadMs=clock()-loadStart;
const bundle=(await build({stdin:{contents:"import Parser from './src/parse.mjs'; globalThis.library={Parser};",resolveDir:repo},bundle:true,platform:'neutral',mainFields:['main'],format:'iife',write:false})).outputFiles[0].text;
// Only copied primitive values/bytes cross the boundary. The callbacks are captured
// in closures, not exposed as raw isolated-vm Reference objects.
const bootstrap=`(()=>{let enc,dec,read;
 globalThis.__bind=(a,b,c)=>{enc=a;dec=b;read=c;delete globalThis.__bind};
 globalThis.TextEncoder=class{encode(text=''){return new Uint8Array(enc(JSON.stringify(String(text))))}};
 globalThis.TextDecoder=class{decode(bytes=new Uint8Array()){return JSON.parse(dec(bytes.buffer,bytes.byteOffset,bytes.byteLength))}};
 globalThis.makeSource=byteLength=>({byteLength,read(a,b){return new Uint8Array(read(a,b))}});
})();`;
const encoder=new TextEncoder(),decoder=new TextDecoder();
function fixture(n){const index={},chunks=[],values=[];let offset=0;
 for(let i=0;i<=n;i++){
  const item={name:'Padmé 𠮷 '+i,value:i,group:i%20,active:i%3===0,note:'Unicode café 日本語 '+('x'.repeat(i%80))};
  const body=i===0?`{"items":[~1-${n}]}`:`<object id="${i}">${JSON.stringify(item)}`;
  if(i)values.push(item);
  const bytes=Buffer.from(`(${Buffer.byteLength(body)})${body}`);index[i]=[offset,offset+bytes.length];chunks.push(bytes,Buffer.from('\n'));offset+=bytes.length+1;
 }
 const path=`${engine}-fixture-${n}.odjt`;writeFileSync(path,Buffer.concat(chunks));const fd=openSync(path,'r');
 const ranges=new Map(Object.values(index));let reads=0,bytesRead=0;
 return {n,index,values,size:offset,read(a,b){assert.ok(Number.isSafeInteger(a)&&ranges.get(a)===b,'invalid source range');const bytes=Buffer.alloc(b-a);let used=0;while(used<bytes.length){const count=readSync(fd,bytes,used,bytes.length-used,a+used);assert.ok(count>0);used+=count;}reads++;bytesRead+=bytes.length;return bytes;},stats(){return{reads,bytesRead}},close(){closeSync(fd)}};
}
const data=[fixture(1000),fixture(10000)];
function create(input,snapshot){
 const start=clock();let evaluate,dispose,bind,heap;
 if(ivm){const isolate=new ivm.Isolate({memoryLimit:64,...(snapshot?{snapshot}:{})});const ctx=isolate.createContextSync();
  evaluate=code=>ctx.evalSync(code,{timeout:10000});
  bind=()=>ctx.evalClosureSync('__bind($0,$1,$2)',[
   new ivm.Callback(text=>encoder.encode(JSON.parse(text)).buffer),
   new ivm.Callback((buffer,start,length)=>JSON.stringify(decoder.decode(new Uint8Array(buffer,start,length)))),
   new ivm.Callback((a,b)=>Uint8Array.from(input.read(a,b)).buffer)
  ]);
  heap=()=>isolate.getHeapStatisticsSync();dispose=()=>isolate.dispose();
 }else{const q=QuickJS.newContext();q.runtime.setMemoryLimit(64*1024*1024);let deadline=0;q.runtime.setInterruptHandler(()=>Date.now()>deadline);
  evaluate=code=>{deadline=Date.now()+10000;const result=q.evalCode(code);const h=result.error||result.value;try{const value=q.dump(h);if(result.error)throw Error(JSON.stringify(value));return value;}finally{h.dispose()}};
  function expose(name,fn){const h=q.newFunction(name,fn);q.setProp(q.global,name,h);h.dispose()}
  bind=()=>{expose('__enc',text=>q.newArrayBuffer(encoder.encode(JSON.parse(q.getString(text)))));
   expose('__dec',(buffer,start,length)=>{const bytes=q.getArrayBuffer(buffer);try{return q.newString(JSON.stringify(decoder.decode(bytes.value.subarray(q.getNumber(start),q.getNumber(start)+q.getNumber(length)))))}finally{bytes.dispose()}});
   expose('__read',(a,b)=>q.newArrayBuffer(input.read(q.getNumber(a),q.getNumber(b))));evaluate('__bind(__enc,__dec,__read);delete globalThis.__enc;delete globalThis.__dec;delete globalThis.__read;void 0;');};
  heap=()=>null;dispose=()=>q.dispose();
 }
 const created=clock();if(!snapshot)evaluate(bootstrap);bind();if(!snapshot)evaluate(bundle+'\nvoid 0;');const loaded=clock();
 evaluate(`globalThis.parser=new library.Parser();globalThis.root=parser.parse(makeSource(${input.size}),${JSON.stringify(input.index)});void 0;`);
 return {evaluate,dispose,heap,times:{createMs:created-start,libraryMs:loaded-created,parseRootMs:clock()-loaded,totalMs:clock()-start}};
}
const result={engine,node:process.version,cpu:cpus()[0].model,moduleLoadMs,bundleBytes:Buffer.byteLength(bundle),fixtures:data.map(f=>({records:f.n,bytes:f.size})),startup:[],workloads:[],checks:{}};
let snapshot;
if(ivm){const start=clock();snapshot=ivm.Isolate.createSnapshot([{code:bootstrap},{code:bundle}]);result.snapshotBuildMs=clock()-start;result.snapshotBytes=snapshot.copy().byteLength;}
for(const useSnapshot of ivm?[false,true]:[false])for(let i=0;i<7;i++){const vm=create(data[0],useSnapshot?snapshot:null);assert.equal(vm.evaluate('root.items.length'),1000);assert.equal(vm.evaluate('root.items[0].name'),'Padmé 𠮷 1');result.startup.push({snapshot:useSnapshot,...vm.times});vm.dispose();}
const expression='(()=>{let sum=0;for(let i=0;i<1000000;i++)sum+=i;return sum})()';
for(const input of data){const vm=create(input);const evaluate=vm.evaluate;
 result.checks.globals=JSON.parse(evaluate('JSON.stringify({process:typeof process,require:typeof require,fetch:typeof fetch})'));
 for(const text of ['','a\u0000b','\ufeffabc','Padmé 𠮷','\ud800'])assert.equal(JSON.parse(evaluate(`JSON.stringify(new TextDecoder().decode(new TextEncoder().encode(${JSON.stringify(text)})))`)),decoder.decode(encoder.encode(text)));
 if(input.n===1000){
  try{evaluate("import x from 'node:fs'");throw Error('static import allowed')}catch(e){assert.match(e.message,/SyntaxError|Unexpected|import|could not load module/);result.checks.staticImport=e.message;}
  if(ivm){evaluate(`globalThis.importResult='pending';import('node:fs').then(()=>importResult='ALLOWED',e=>importResult=e.message);void 0;`);result.checks.dynamicImport=evaluate('importResult');assert.notEqual(result.checks.dynamicImport,'ALLOWED');assert.notEqual(result.checks.dynamicImport,'pending');}
 }
 const expectedFilter=JSON.stringify(input.values.filter(x=>x.active&&x.value>input.n/2).sort((a,b)=>b.value-a.value).slice(0,50).map(x=>({name:x.name,value:x.value})));
 const expectedOutput=JSON.stringify(input.values.slice(0,1000).map(x=>({name:x.name,value:x.value,note:x.note})));
 const workloads=[
 ['return_one','1',1],
 ['compute_million',expression,499999500000],
 ['scan',`root.items.reduce((sum,item)=>sum+item.value,0)`,input.n*(input.n+1)/2],
 ['filter_sort_project',`JSON.stringify(root.items.filter(x=>x.active&&x.value>${input.n/2}).sort((a,b)=>b.value-a.value).slice(0,50).map(x=>({name:x.name,value:x.value})))`,expectedFilter],
 ['serialize_1000',`JSON.stringify(root.items.slice(0,1000).map(x=>({name:x.name,value:x.value,note:x.note})))`,expectedOutput],
 ['cached_lookup_1000',`(()=>{let sum=0;for(let i=0;i<1000;i++)sum+=root.items[0].value;return sum})()`,1000]
 ];
 for(const [name,source,expected] of workloads){
  const measurements=[];for(let i=0;i<12;i++){const before=input.stats();const start=clock();const value=evaluate(source);const ms=clock()-start;assert.equal(value,expected,name);const after=input.stats();measurements.push({ms,reads:after.reads-before.reads,bytes:after.bytesRead-before.bytesRead});}
  console.error('completed',engine,input.n,name);
  result.workloads.push({name,records:input.n,first:measurements[0],warmup:measurements.slice(1,3),samples:measurements.slice(3)});
 }
 result.heapAfter=vm.heap();vm.dispose();
}
if(ivm){const vm=create(data[0]);const start=clock();try{vm.evaluate('while(true){}')}catch(e){result.checks.timeout={ms:clock()-start,message:e.message}}vm.dispose();}
for(const f of data)f.close();snapshot?.release();writeFileSync(`${engine}-results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({engine,moduleLoadMs,startup:result.startup,workloads:result.workloads.map(w=>({name:w.name,records:w.records,median:w.samples.map(x=>x.ms).sort((a,b)=>a-b)[4],reads:w.samples[0].reads})),checks:result.checks},null,2));
