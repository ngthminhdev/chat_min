"""Exercise native import/write CLI against disposable synthetic databases ONLY.

Build separately: cargo build --manifest-path src-tauri/Cargo.toml --bin chatmin
This script never references the user's database or provider/session files.
"""
import json, math, os, pathlib, sqlite3, statistics, subprocess, tempfile, time
HERE=pathlib.Path(__file__).resolve().parent
REPO=HERE.parents[3]
BINARY=REPO/'src-tauri/target/debug/chatmin'
ACCOUNT='zalo-synthetic-benchmark'
OWNER='1'
def stats(values):
    s=sorted(values)
    return {'iterations':len(s),'median_ms':round(statistics.median(s),4),'p95_ms':round(s[math.ceil(.95*len(s))-1],4),'max_ms':round(max(s),4)}
GENERATOR=r'''
import {writeFileSync} from 'node:fs';
import {normalizeMessage,normalizeChat} from '__MODULE__';
const account='zalo-synthetic-benchmark',owner='1',now=Date.now()-20000;
const records=[];
for(let i=0;i<10000;i++){
 const peer=String(100+i%20),media=i%4===0;
 const raw={type:1,threadId:peer,isSelf:false,data:{msgId:String(i+1),uidFrom:String(1000+i%250),ts:String(now+i),dName:'Synthetic',msgType:media?'chat.photo':'webchat',content:media?{title:'Synthetic photo',params:'{"width":128,"height":128}'}:'Synthetic searchable benchmark message'}};
 records.push(JSON.stringify({ownerSelfId:owner,msg:normalizeMessage(account,raw,owner),chat:normalizeChat(account,1,peer,{name:'Synthetic chat'})}));
}
writeFileSync(process.argv[1],records.join('\n')+'\n',{mode:0o600});
'''.replace('__MODULE__',(REPO/'connectors/zalo/normalize.mjs').as_uri())
def counters(db):
    c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True)
    result={'messages':c.execute('SELECT count(*) FROM messages').fetchone()[0],'fts_rows':c.execute('SELECT count(*) FROM messages_fts').fetchone()[0],'chats':c.execute('SELECT count(*) FROM chats').fetchone()[0],'unread_sum':c.execute("SELECT coalesce(sum(json_extract(data,'$.unread')),0) FROM chats").fetchone()[0],'media_messages':c.execute("SELECT count(*) FROM messages WHERE json_extract(data,'$.kind')='media'").fetchone()[0]}
    c.close();return result
def invoke(db,input):
    started=time.perf_counter_ns()
    proc=subprocess.run([str(BINARY),'--import-zalo-cache',str(db),str(input),ACCOUNT],capture_output=True,text=True,check=True)
    elapsed=(time.perf_counter_ns()-started)/1e6
    return elapsed,json.loads(proc.stdout)
result={'scope':'Real debug Rust process -> Store::open/migrations -> JSONL/Serde -> import_zalo_records batches of 100 -> messages/thread index/FTS/chat metadata writes on synthetic temporary DB only.','input_messages':10000,'input_chats':20,'media_fraction':.25,'native_process_includes':'Process startup/shutdown, SQLite open/migrations, input file reads, JSON decode, validation, 100 transactions, writes/index maintenance and final connection close. Generation/build excluded.','cold_limit':'Fresh synthetic SQLite DB per first import; OS cache not purged. Repeat imports reuse same DB. No disk-cold claim.','samples':[]}
assert BINARY.is_file(),'Build debug chatmin binary before running benchmark'
with tempfile.TemporaryDirectory(prefix='chatmin-synthetic-import-') as temp:
    private=pathlib.Path(temp);os.chmod(private,0o700)
    input=private/'synthetic.jsonl'
    subprocess.run(['node','--input-type=module','-e',GENERATOR,str(input)],check=True,capture_output=True)
    result['input_bytes']=input.stat().st_size
    firsts=[];repeats=[]
    for iteration in range(3):
        db=private/f'synthetic-{iteration}.db'
        assert db.parent==private
        c=sqlite3.connect(db)
        c.execute('CREATE TABLE accounts(id TEXT PRIMARY KEY,data TEXT NOT NULL,position INTEGER NOT NULL)')
        account={'id':ACCOUNT,'platform':'zalo','name':'Synthetic','color':'blue','handle':'','selfId':OWNER}
        c.execute('INSERT INTO accounts VALUES(?,?,?)',(ACCOUNT,json.dumps(account),1));c.commit();c.close()
        elapsed,report=invoke(db,input);firsts.append(elapsed)
        assert report=={'read':10000,'inserted':10000,'existing':0},'Unexpected initial import totals'
        initial=counters(db)
        assert initial=={'messages':10000,'fts_rows':10000,'chats':20,'unread_sum':0,'media_messages':2500},'Unexpected initial cache totals'
        elapsed2,report2=invoke(db,input);repeats.append(elapsed2)
        assert report2=={'read':10000,'inserted':0,'existing':10000},'Unexpected duplicate import totals'
        after=counters(db);assert after==initial,'Repeat import changed aggregate counts'
        result['samples'].append({'initial_ms':round(elapsed,4),'repeat_ms':round(elapsed2,4),'initial_report':report,'repeat_report':report2,'counters_after_repeat':after,'database_bytes':db.stat().st_size})
    # Bounded production SQL and decode after native writes; Python query runtime.
    c=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True,cached_statements=0)
    sql='SELECT data FROM messages WHERE account_id = ?1 AND chat_id = ?2 AND sort < ?3 ORDER BY sort DESC LIMIT ?4'
    cursor=c.execute('SELECT sort FROM messages WHERE account_id=? AND chat_id=? ORDER BY sort DESC LIMIT 1 OFFSET 99',(ACCOUNT,'g:100')).fetchone()[0]
    result['bounded_queries']={}
    for label,before in [('latest_50',2**63-1),('older_50',cursor)]:
        values=[];count=0;args=(ACCOUNT,'g:100',before,50)
        for i in range(200):
            start=time.perf_counter_ns();rows=[json.loads(r[0]) for r in c.execute(sql,args)];rows.reverse();values.append((time.perf_counter_ns()-start)/1e6);count=len(rows)
        assert count==50
        result['bounded_queries'][label]={**stats(values),'rows':count,'query_plan':[r[3] for r in c.execute('EXPLAIN QUERY PLAN '+sql,args)]}
    c.close()
result['initial_import']=stats(firsts);result['idempotent_repeat_import']=stats(repeats)
result['limitations']='Debug build, 3 process samples only, no release-build throughput claim; query phase uses Python SQLite/json.loads. No UI/IPC/provider/network or concurrent writer. Temp DBs and JSONL deleted after run.'
(HERE/'native-import-results.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
