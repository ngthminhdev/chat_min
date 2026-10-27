"""Read-only cache benchmark; emit aggregate counts/timings, never row identities/content."""
import sqlite3, json, time, math, statistics, pathlib, platform, sys
ROOT = pathlib.Path(__file__).resolve().parent
DB = pathlib.Path(sys.argv[1]).expanduser().resolve() if len(sys.argv)>1 else pathlib.Path.home()/'Library/Application Support/com.chatmin.app/chatmin.db'
PAGE = '''SELECT data FROM messages WHERE account_id = ?1 AND chat_id = ?2 AND sort < ?3
                 ORDER BY sort DESC LIMIT ?4'''
PRIMARY = '''SELECT data FROM messages WHERE account_id = ?1 AND chat_id = ?2 AND sort < ?3
             AND json_extract(data, '$.threadReply') = 0 ORDER BY sort DESC LIMIT ?4'''
SEARCH = '''SELECT m.data FROM messages_fts f
                 JOIN messages m ON m.account_id = f.account_id AND m.chat_id = f.chat_id AND m.id = f.id
                 WHERE messages_fts MATCH ?1 AND (?2 = '' OR f.account_id = ?2) AND (?3 = '' OR f.chat_id = ?3)
                 ORDER BY json_extract(m.data, '$.ts') DESC LIMIT ?4'''
def connect():
    c = sqlite3.connect(DB.as_uri()+'?mode=ro', uri=True, cached_statements=0)
    c.execute('PRAGMA query_only=ON')
    return c
def stats(v):
    s=sorted(v)
    return {'iterations':len(s),'median_ms':round(statistics.median(s),4),'p95_ms':round(s[math.ceil(.95*len(s))-1],4),'max_ms':round(max(s),4)}
def run(c, sql, args):
    start=time.perf_counter_ns()
    out=[json.loads(r[0]) for r in c.execute(sql,args)]
    if sql!=SEARCH:out.reverse()
    return (time.perf_counter_ns()-start)/1e6,len(out)
def bench(c,sql,args,n=200):
    first,count=run(c,sql,args)
    warm=[run(c,sql,args)[0] for _ in range(n)]
    reopened=[]
    for _ in range(30):
        cold=connect()
        reopened.append(run(cold,sql,args)[0]);cold.close()
    return {'rows':count,'first_existing_connection_ms':round(first,4),'warm':stats(warm),'reopened_sqlite_cache_os_warm':stats(reopened),'query_plan':[r[3] for r in c.execute('EXPLAIN QUERY PLAN '+sql,args)]}
c=connect()
result={'scope':'Exact Store::msgs/primary_msgs/search SQL with Python json.loads; not Rust serde/IPC/UI/provider timings.', 'runtime':platform.python_version(), 'sqlite':sqlite3.sqlite_version,'cold_limit':'Reopened connections reset SQLite page/statement caches. OS filesystem cache not flushed; no disk-cold claim. Connection-open time excluded.', 'database_bytes':DB.stat().st_size,'wal_bytes':pathlib.Path(str(DB)+'-wal').stat().st_size if pathlib.Path(str(DB)+'-wal').exists() else 0,'page_size':c.execute('PRAGMA page_size').fetchone()[0],'sqlite_cache_size':c.execute('PRAGMA cache_size').fetchone()[0],'providers':{}}
accounts={r[0]:json.loads(r[1]).get('platform','unknown') for r in c.execute('SELECT id,data FROM accounts')}
for provider in ['telegram','gchat','zalo']:
    ids=[a for a,p in accounts.items() if p==provider]
    rows=[r for r in c.execute('SELECT account_id,chat_id,count(*) FROM messages GROUP BY account_id,chat_id') if r[0] in ids]
    item={'accounts':len(ids),'cached_chats':len(rows),'cached_messages':sum(r[2] for r in rows)}
    if rows:
        a,ch,count=max(rows,key=lambda r:r[2]);item['largest_chat_messages']=count
        cursor=c.execute('SELECT sort FROM messages WHERE account_id=? AND chat_id=? ORDER BY sort DESC LIMIT 1 OFFSET 99',(a,ch)).fetchone()
        item['latest_50']=bench(c,PAGE,(a,ch,2**63-1,50))
        if cursor:item['older_50']=bench(c,PAGE,(a,ch,cursor[0],50))
        if provider=='gchat':item['primary_latest_50']=bench(c,PRIMARY,(a,ch,2**63-1,50))
        # Fixed public probe, not derived from user's private message contents.
        item['search_fixed_prefix']=bench(c,SEARCH,('"a"*',a,ch,50),60)
    result['providers'][provider]=item
result['global_search_fixed_prefix']=bench(c,SEARCH,('"a"*','','',50),60)
c.close()
(ROOT/'cache-results.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
