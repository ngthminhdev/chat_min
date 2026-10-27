import fs from 'node:fs';
export class PrivateCache {
  constructor(path){this.path=path;this.pending=undefined;this.timer=null;this.chain=Promise.resolve();}
  read(){try{return JSON.parse(fs.readFileSync(this.path,'utf8'));}catch{return {};}}
  schedule(value){this.pending=value;clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.flush().catch(()=>{});},250);}
  flush(){
    clearTimeout(this.timer);this.timer=null;if(this.pending===undefined)return this.chain;
    const text=JSON.stringify(this.pending);this.pending=undefined;
    this.chain=this.chain.catch(()=>{}).then(async()=>{const temp=this.path+'.'+process.pid+'.tmp';await fs.promises.writeFile(temp,text,{mode:0o600});await fs.promises.chmod(temp,0o600);await fs.promises.rename(temp,this.path);});
    return this.chain;
  }
}
