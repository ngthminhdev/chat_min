// Pinned SDK omits history continuation metadata from its public event. Expose only
// already-decoded metadata; preserve the SDK's original event and protocol handling.
export function patchListener(source){
  for(const [kind,type] of [['User',0],['Group',1]]){
    const anchor=`this.emit("old_messages", responseMsgs, ThreadType.${kind});`;
    if(source.split(anchor).length!==2)throw Error('zca-js listener patch mismatch; inspect pinned SDK before building');
    source=source.replace(anchor,anchor+`\nthis.emit("chatmin_history_page", {type:${type}, messages:responseMsgs, more:parsedData.more, lastActionId:parsedData.lastActionId});`);
  }
  return source;
}
