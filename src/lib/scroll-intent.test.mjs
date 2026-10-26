import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync(new URL('../components/useStickyScroll.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
function hook() {
  const effects=[],listeners={};let loads=0;
  const el={clientHeight:1000,scrollHeight:3000,scrollTop:0,firstElementChild:{scrollHeight:3000},
    getBoundingClientRect:()=>({top:0}),querySelectorAll:()=>[],querySelector:()=>null,
    addEventListener:(name,fn)=>{listeners[name]=fn;},removeEventListener:()=>{},scrollTo:()=>{}};
  const react={useRef:v=>({current:v}),useState:v=>[v,()=>{}],useEffect:fn=>effects.push(fn),useLayoutEffect:fn=>effects.push(fn)};
  const exports={};
  vm.runInNewContext(compiled,{exports,require:name=>({react,'../lib/bridge':{api:{logJs:()=>Promise.resolve()}},
    '../store':{useApp:Object.assign(fn=>fn({toLatest:0}),{getState:()=>({active:'test'})})},
    '../lib/motion':{preferredScrollBehavior:()=> 'auto'}})[name],
    document:{getElementById:()=>null},ResizeObserver:class{observe(){}disconnect(){}},setTimeout:()=>0,clearTimeout:()=>{},Date});
  const scroll=exports.useStickyScroll({current:el},'latest',()=>{loads++;});
  effects.forEach(fn=>fn());
  return {el,scroll,listeners,get loads(){return loads;}};
}
test('programmatic initial positioning never starts older-history loading',()=>{
  const h=hook();h.el.scrollTop=0;h.scroll.onScroll();assert.equal(h.loads,0);
});
test('an intentional upward scroll near the top requests older history',()=>{
  const h=hook();h.listeners.wheel();h.el.scrollTop=80;h.scroll.onScroll();assert.equal(h.loads,1);
});
test('a short timeline at its bottom never auto-fetches older pages',()=>{
  const h=hook();h.el.scrollHeight=700;h.el.clientHeight=1000;h.el.scrollTop=0;h.scroll.onScroll();assert.equal(h.loads,0);
});
