import os,socket,struct,threading,subprocess,selectors,time,json,pathlib,shutil,argparse,re,tempfile,hashlib
arguments=argparse.ArgumentParser(description='Disposable ext4 VM power-loss exercise; never uses a host block device')
arguments.add_argument('--qemu',required=True)
arguments.add_argument('--kernel',required=True)
arguments.add_argument('--firmware-dir',required=True)
arguments.add_argument('--bios',required=True)
arguments.add_argument('--library-path',default='')
arguments.add_argument('--work')
args=arguments.parse_args()
ROOT=pathlib.Path(args.work) if args.work else pathlib.Path(tempfile.mkdtemp(prefix='simplystore-vm-exercise-'))
if args.work: ROOT.mkdir(parents=True,exist_ok=False)
QEMU=pathlib.Path(args.qemu).resolve()
repo=pathlib.Path(__file__).resolve().parents[2]
env={**os.environ,**({'LD_LIBRARY_PATH':args.library_path} if args.library_path else {})}
guest=ROOT/'guest'
for directory in ['bin','proc','sys','dev','store','tmp','lib64','app']:(guest/directory).mkdir(parents=True,exist_ok=True)
shutil.copy(shutil.which('busybox'),guest/'bin/busybox')
for command in ['sh','mount','mkdir','sleep','cat','poweroff','ip']:(guest/'bin'/command).symlink_to('busybox')
node=shutil.which('node');shutil.copy(node,guest/'bin/node')
for library in re.findall(r'(/[^\s]+)',subprocess.check_output(['ldd',node],text=True)):
    dest=guest/library.lstrip('/');dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy(library,dest)
for folder in ['src','node_modules','www']:shutil.copytree(repo/folder,guest/'app'/folder)
shutil.copy(pathlib.Path(__file__).with_name('guest.mjs'),guest/'app/guest.mjs')
(guest/'app/package.json').write_text('{"type":"module"}')
(guest/'init').write_text("#!/bin/sh\nexport PATH=/bin\nmount -t proc proc /proc\nmount -t sysfs sysfs /sys\nmount -t devtmpfs devtmpfs /dev\nip link set lo up\nmount -t ext4 -o data=ordered,barrier=1 /dev/vda /store || exec sh\ncd /app\nnode /app/guest.mjs\nwhile true; do sleep 100; done\n")
os.chmod(guest/'init',0o755)
with open(ROOT/'initrd.gz','wb') as output:
    files=subprocess.Popen(['find','.','-print0'],cwd=guest,stdout=subprocess.PIPE)
    cpio=subprocess.Popen(['cpio','--null','-o','--format=newc'],cwd=guest,stdin=files.stdout,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    files.stdout.close()
    subprocess.run(['gzip','-1'],stdin=cpio.stdout,stdout=output,check=True)
    cpio.stdout.close();assert cpio.wait()==0 and files.wait()==0
metadata={'qemu':subprocess.check_output([str(QEMU),'--version'],env=env,text=True),'node':subprocess.check_output([node,'--version'],text=True),'kernelSha256':hashlib.sha256(pathlib.Path(args.kernel).read_bytes()).hexdigest(),'repositoryHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'worktreeDiffSha256':hashlib.sha256(subprocess.check_output(['git','diff','HEAD'],cwd=repo)).hexdigest(),'filesystem':'ext4 data=ordered,barrier=1','device':'virtio-blk, QEMU cache=writeback, volatile NBD backend honoring FLUSH/FUA','acceleration':'TCG, 2 CPUs, 1024 MiB','physicalPowerCut':False}
(ROOT/'environment.json').write_text(json.dumps(metadata,indent=2))
print('Artifacts: '+str(ROOT),flush=True)
class Disk:
 def __init__(self,image):
  self.image=image;self.data=bytearray(image.read_bytes());self.dirty=set();self.flushes=0;self.writes=0;self.lost=0
  self.sockpath=str(ROOT/'block.sock')
  try:os.unlink(self.sockpath)
  except FileNotFoundError:pass
  self.server=socket.socket(socket.AF_UNIX);self.server.bind(self.sockpath);self.server.listen(1)
  self.thread=threading.Thread(target=self.serve,daemon=True);self.thread.start()
 def serve(self):
  try:
   self.conn,_=self.server.accept();c=self.conn
   c.sendall(struct.pack('>QQQI',0x4e42444d41474943,0x0000420281861253,len(self.data),1|4|8)+bytes(124))
   def receive(n):
    data=b''
    while len(data)<n:
     part=c.recv(n-len(data))
     if not part:raise EOFError()
     data+=part
    return data
   def persist(pages):
    with open(self.image,'r+b',buffering=0) as f:
     for page in sorted(pages):f.seek(page*4096);f.write(self.data[page*4096:(page+1)*4096])
     os.fsync(f.fileno())
    self.dirty.difference_update(pages)
   while True:
    magic,flags,kind,handle,offset,length=struct.unpack('>IHHQQI',receive(28))
    assert magic==0x25609513
    response=b''
    if kind==0:response=bytes(self.data[offset:offset+length])
    elif kind==1:
     self.data[offset:offset+length]=receive(length);pages=set(range(offset//4096,(offset+length+4095)//4096));self.dirty.update(pages);self.writes+=1
     if flags&1:persist(pages)
    elif kind==2:break
    elif kind==3:self.flushes+=1;persist(set(self.dirty))
    else:raise RuntimeError('Unsupported NBD command '+str(kind))
    c.sendall(struct.pack('>IIQ',0x67446698,0,handle)+response)
  except (EOFError,ConnectionResetError,BrokenPipeError,OSError):pass
 def stop(self):
  self.server.close()
  if hasattr(self,'conn'):
   try:self.conn.shutdown(socket.SHUT_RDWR)
   except OSError:pass
   self.conn.close()
  self.thread.join(2);self.lost=len(self.dirty)

def boot(image,scenario,recover=False):
 disk=Disk(image)
 command=[str(QEMU),'-L',args.firmware_dir,'-vga','none','-machine','pc,accel=tcg','-cpu','max','-m','1024','-smp','2','-display','none','-monitor','none','-serial','stdio','-no-reboot','-net','none','-bios',args.bios,'-kernel',args.kernel,'-initrd',str(ROOT/'initrd.gz'),'-append',f'console=ttyS0 quiet panic=-1 scenario={scenario}','-drive',f'file=nbd:unix:{disk.sockpath},if=virtio,format=raw,cache=writeback']
 p=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env)
 selector=selectors.DefaultSelector();selector.register(p.stdout,selectors.EVENT_READ)
 lines=b'';deadline=time.time()+90;found=None
 marker=b'VERIFY ' if recover else {'done':b'CUT_DONE','accepted':b'CUT_ACCEPTED','active':b'CUT_ACTIVE','unsynced':b'CUT_UNSYNCED'}[scenario]
 try:
  while time.time()<deadline:
   for key,_ in selector.select(.2):
    chunk=os.read(key.fd,65536)
    if not chunk:raise RuntimeError('Guest exited: '+lines.decode(errors='replace'))
    lines+=chunk
    if marker in lines and b'\n' in lines[lines.index(marker):]:
     found=lines[lines.index(marker):].splitlines()[0].decode();break
   if found:break
  if not found:raise RuntimeError('Timeout: '+lines.decode(errors='replace'))
 finally:
  p.kill();p.wait();disk.stop()
  (ROOT/f'{scenario}-{ "verify" if recover else "cut"}.log').write_bytes(lines)
 print(json.dumps({'scenario':scenario,'recover':recover,'marker':found,'flushes':disk.flushes,'writes':disk.writes,'discardedDirtyPages':disk.lost}),flush=True)
 return found

# Validate the device-loss model independently of filesystem/engine behavior.
control=ROOT/'device-control.img';control.write_bytes(bytes(16384))
disk=Disk(control);client=socket.socket(socket.AF_UNIX);client.connect(disk.sockpath)
def recv_exact(n):
    data=b''
    while len(data)<n:data+=client.recv(n-len(data))
    return data
recv_exact(152)
def request(kind,offset=0,data=b''):
    client.sendall(struct.pack('>IHHQQI',0x25609513,0,kind,1,offset,len(data))+data)
    assert recv_exact(16)==struct.pack('>IIQ',0x67446698,0,1)
request(1,0,b'A'*4096);request(3);request(1,4096,b'B'*4096)
client.close();disk.stop()
assert control.read_bytes()[:4096]==b'A'*4096 and control.read_bytes()[4096:8192]==bytes(4096)
assert disk.lost==1
print(json.dumps({'deviceControl':'flushed A survives; unflushed B lost','discardedDirtyPages':disk.lost}),flush=True)
results=[]
for scenario in ['done','accepted','active','unsynced']:
 image=ROOT/f'{scenario}.img'
 with open(image,'wb') as f:f.truncate(128*1024*1024)
 subprocess.run(['mkfs.ext4','-q','-F','-O','^metadata_csum_seed',str(image)],check=True)
 cut=boot(image,scenario)
 result=json.loads(boot(image,scenario,True).removeprefix('VERIFY '))
 assert not result['errors'],result
 if scenario=='done':assert result['ready'] and result['persons']==[{'name':name} for name in ['A','L0','L1','L2','L3']],result
 elif scenario=='unsynced':assert result['ready'] and not result['unsyncedPresent'],result
 else:assert len(result['commands'])==1 and result['commands'][0]['id']=='A' and result['commands'][0]['status'] in ['accepted','active'],result
 results.append({'scenario':scenario,'cut':cut,'recovered':result})
(ROOT/'results.json').write_text(json.dumps(results,indent=2))
