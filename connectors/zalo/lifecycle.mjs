// A TCP/WebSocket open is insufficient: backlog requires the protocol cipher handshake.
export function startListener(listener,{timeoutMs=25000}={}) {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{clearTimeout(timer);listener.off('cipher_key',ready);listener.off('disconnected',disconnected);listener.off('error',error);};
    const finish=(err)=>{if(settled)return;settled=true;cleanup();if(err){listener.removeAllListeners();listener.on('error',()=>{});listener.stop();reject(err);}else resolve();};
    const ready=()=>finish();
    const disconnected=()=>finish(Error('socket_disconnected'));
    const error=()=>finish(Error('socket_error'));
    const timer=setTimeout(()=>finish(Error('socket_timeout')),timeoutMs);
    listener.once('cipher_key',ready);listener.once('disconnected',disconnected);listener.once('error',error);
    try{listener.start({retryOnClose:false});}catch{finish(Error('socket_start_failed'));}
  });
}
export function shouldRetryResume(error) {
  const code=error?.cause?.code || error?.code;
  return ['ETIMEDOUT','ECONNRESET','ENOTFOUND','EAI_AGAIN','EHOSTUNREACH','ECONNREFUSED','UND_ERR_CONNECT_TIMEOUT'].includes(code)
    || /socket_|fetch failed|network|Service Unavailable|Bad Gateway|Gateway Timeout/i.test(error?.message || '');
}
