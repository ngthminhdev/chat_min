import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {startListener,shouldRetryResume} from './lifecycle.mjs';
import {Zalo,CloseReason} from 'zca-js';
import {imageSizeFromFile} from 'image-size/fromFile';
import {ZaloRuntime} from './runtime.mjs';
import {PrivateCache} from './private-cache.mjs';
// Only RPC frames go to stdout; SDK diagnostics must never corrupt the wire or leak sessions.
console.log=()=>{}; console.warn=()=>{}; console.error=()=>{};
const [accountId,dir,mode,expected='']=process.argv.slice(2);
if(!/^zalo-[a-zA-Z0-9-]+$/.test(accountId || '') || !dir)process.exit(2);
fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.chmodSync(dir,0o700);
const credentialPath=path.join(dir,'session.json');
const profileFile=new PrivateCache(path.join(dir,'profiles.json'));
const emit=(v)=>process.stdout.write(JSON.stringify(v)+'\n');
let runtime=null,stopping=false,reconnecting=false,retryTimer=null,qrAbort=null;
const health=(state,text)=>emit({event:'health',health:state,text});
function save(credentials){const temp=credentialPath+'.tmp';fs.writeFileSync(temp,JSON.stringify(credentials),{mode:0o600});fs.chmodSync(temp,0o600);fs.renameSync(temp,credentialPath);}
async function connect(qr=false){
  const zalo=new Zalo({logging:false,checkUpdate:false,selfListen:true,imageMetadataGetter:async(file)=>{const {width,height}=await imageSizeFromFile(file);return {width,height,size:fs.statSync(file).size};}});
  let credentials=null;
  const api=qr?await zalo.loginQR({},e=>{
    if(stopping){e.actions?.abort();return;}
    qrAbort=e.actions?.abort || qrAbort;
    if(e.type===0)emit({event:'auth',step:'qr',info:'data:image/png;base64,'+e.data.image});
    else if(e.type===1)e.actions.retry();
    else if(e.type===2)emit({event:'auth',step:'qr',info:'',status:'Đã quét, xác nhận trên điện thoại'});
    else if(e.type===3)emit({event:'auth',step:'error',error:'Bạn đã từ chối đăng nhập Zalo'});
    else if(e.type===4)credentials=e.data;
  }):await zalo.login(JSON.parse(fs.readFileSync(credentialPath,'utf8')));
  if(stopping){api.listener.stop();return;}
  const me=String(api.getOwnId());
  if(expected && me!==expected){api.listener.stop();throw new Error('wrong_account');}
  const next=new ZaloRuntime({accountId,api,emit,seedProfiles:profileFile.read().users || [],onProfiles:users=>profileFile.schedule({users})});next.attach();
  await startListener(api.listener);
  if(stopping){api.listener.stop();return;}
  if(credentials)save(credentials);
  runtime=next;
  api.listener.on('disconnected',code=>{
    if(stopping || runtime!==next || code===CloseReason.ManualClosure)return;
    runtime=null;
    if(code===CloseReason.DuplicateConnection || code===CloseReason.KickConnection){health('expired',code===CloseReason.DuplicateConnection?'Phiên Zalo bị trùng; đóng Zalo Web và đăng nhập lại':'Zalo đã ngắt phiên, cần đăng nhập lại');return;}
    health('reconnecting','Đang kết nối lại Zalo');scheduleReconnect();
  });
  emit({event:'account',account:{id:accountId,platform:'zalo',name:'Zalo',color:'blue',handle:'',selfId:me}});
  health('ok','Đã kết nối Zalo');
  emit({event:'sync',step:0,state:'ok',log:'Đã xác thực tài khoản Zalo'});
  emit({event:'auth',step:'ready',info:''});
  void next.discover().catch(()=>{if(runtime===next)emit({event:'sync',step:1,state:'err',log:'Chưa tải đủ danh sách Zalo. Đăng nhập lại để thử lại.'});});
}
function scheduleReconnect(){
  if(retryTimer || reconnecting || stopping)return;
  retryTimer=setTimeout(async()=>{
    retryTimer=null;reconnecting=true;let retry=true;
    try{await connect();}
    catch(e){retry=shouldRetryResume(e);health(retry?'offline':'expired',retry?'Chưa kết nối được Zalo; sẽ thử lại':'Phiên Zalo không hợp lệ, cần đăng nhập lại');}
    finally{reconnecting=false;if(!runtime && retry)scheduleReconnect();}
  },5000);
}
function stop(){if(stopping)return;stopping=true;clearTimeout(retryTimer);qrAbort?.();runtime?.api.listener.stop();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',async line=>{
  let request;try{request=JSON.parse(line);if(!runtime)throw Error('Zalo chưa kết nối');const result=await runtime.call(request.method,request.params);emit({id:request.id,result});}
  catch{if(request?.id)emit({id:request.id,error:'Thao tác Zalo thất bại. Kiểm tra kết nối và thử lại.'});}
}).on('close',stop);
void connect(mode==='qr').catch(e=>{
  if(mode==='resume' && shouldRetryResume(e)){health('reconnecting','Chưa kết nối được Zalo; đang thử lại');scheduleReconnect();return;}
  health('expired',e.message==='wrong_account'?'Mã QR thuộc tài khoản Zalo khác':'Không đăng nhập được Zalo; cần quét QR lại');
  emit({event:'auth',step:'error',error:e.message==='wrong_account'?'Hãy quét QR bằng đúng tài khoản Zalo đang kết nối lại':'Không đăng nhập được Zalo. Thử tạo mã QR mới.'});
});
