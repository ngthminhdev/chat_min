import subprocess,time,json,pathlib,statistics,sys,re
processes=[line.strip().split(None,2) for line in subprocess.check_output(['ps','-axo','pid=,ppid=,comm='],text=True).splitlines()]
app=next(int(pid) for pid,parent,command in processes if command=='/Applications/ChatMin.app/Contents/MacOS/chatmin')
roles={'app':app}
for pid,parent,command in processes:
 if int(parent)==app and command.endswith('/resources/zalo/node'):roles['zalo_worker']=int(pid)
# Additional WebKit roles require explicit attribution; PPID alone does not identify XPC owners.
if len(sys.argv)>2:roles.update({k:int(v) for k,v in json.loads(sys.argv[2]).items()})
phase=sys.argv[1] if len(sys.argv)>1 else 'unscripted-idle'
if not re.fullmatch(r'[A-Za-z0-9_-]+',phase):raise ValueError('invalid output name')

def read(pid):
 s=subprocess.check_output(['ps','-p',str(pid),'-o','time=,rss='],text=True).split()
 parts=s[0].split(':');cpu=0
 for p in parts:cpu=cpu*60+float(p)
 return cpu,int(s[1])/1024
samples={k:[] for k in roles};previous={k:read(v) for k,v in roles.items()};t=time.monotonic();start=t
for _ in range(20):
 time.sleep(1);now=time.monotonic();dt=now-t
 for k,pid in roles.items():
  cpu,rss=read(pid);samples[k].append({'cpuPercentOneCore':max(0,(cpu-previous[k][0])/dt*100),'rssMiB':rss});previous[k]=(cpu,rss)
 t=now
stats={}
for k,rows in samples.items():
 cpu=sorted(x['cpuPercentOneCore'] for x in rows);rss=[x['rssMiB'] for x in rows]
 stats[k]={'cpuMedian':statistics.median(cpu),'cpuP95':cpu[int((len(cpu)-1)*.95)],'cpuMax':max(cpu),'rssMedianMiB':statistics.median(rss),'rssMaxMiB':max(rss)}
out={'phase':phase,'durationSeconds':time.monotonic()-start,'method':'ps cumulative CPU delta / elapsed; RSS includes shared mappings; WebKit inferred roles matched app launch time, confirmed roles matched open app data handles','samples':samples,'stats':stats}
p=pathlib.Path(__file__).with_name(out['phase']+'.json');p.write_text(json.dumps(out,indent=2));print(json.dumps({'phase':out['phase'],'stats':stats}))
