import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { constrainImage, fitImage, pinchImage, type ImagePoint, type ImageTransform } from '../lib/image-viewport';
import { viewerSwipe } from '../lib/mobile-gestures';

export interface ImageZoomControls { zoomIn(): void; zoomOut(): void; reset(): void }
interface Props { src: string; alt: string; onSwipe: (action: 'next'|'previous'|'close') => void }
const initial: ImageTransform={scale:1,x:0,y:0};
type Gesture={kind:'pan'; point:ImagePoint; start:ImageTransform; time:number} | {kind:'pinch'; distance:number; anchor:ImagePoint; start:ImageTransform};

/** Image-only zoom: never zoom the WebView or its toolbar. All bounds use decoded
 * image dimensions, including portrait/EXIF images, rather than cached message metadata. */
export const ZoomableImage=forwardRef<ImageZoomControls,Props>(function ZoomableImage({src,alt,onSwipe},ref) {
  const box=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState({width:0,height:0});
  const [natural,setNatural]=useState({width:0,height:0});
  const [value,setValue]=useState(initial);
  const current=useRef(initial);
  const points=useRef(new Map<number,ImagePoint>());
  const gesture=useRef<Gesture|null>(null);
  const multi=useRef(false);
  const lastTap=useRef<{time:number;point:ImagePoint}|null>(null);
  const fit=fitImage(size.width,size.height,natural.width,natural.height);
  const update=(next:ImageTransform)=>{const bounded=constrainImage(next,fit,size);current.current=bounded;setValue(bounded);};
  const changeZoom=(scale:number)=>update({...current.current,scale});
  useImperativeHandle(ref,()=>({zoomIn:()=>changeZoom(current.current.scale*2),zoomOut:()=>changeZoom(current.current.scale/2),reset:()=>update(initial)}));
  useLayoutEffect(()=>{setNatural({width:0,height:0});current.current=initial;setValue(initial);points.current.clear();gesture.current=null;lastTap.current=null;},[src]);
  useLayoutEffect(()=>{
    const el=box.current;if(!el)return;
    const measure=()=>setSize({width:el.clientWidth,height:el.clientHeight});
    measure();const observer=new ResizeObserver(measure);observer.observe(el);
    return ()=>observer.disconnect();
  },[]);
  useLayoutEffect(()=>{update(current.current);},[fit.width,fit.height,size.width,size.height]);
  const midpoint=()=>{
    const [a,b]=[...points.current.values()],r=box.current!.getBoundingClientRect();
    return {x:(a.x+b.x)/2-r.left-r.width/2,y:(a.y+b.y)/2-r.top-r.height/2};
  };
  const distance=()=>{const [a,b]=[...points.current.values()];return Math.hypot(a.x-b.x,a.y-b.y);};
  const clear=()=>{points.current.clear();gesture.current=null;lastTap.current=null;};
  return <div className="viewer-photo" ref={box} data-scale={value.scale.toFixed(3)}
    onClick={e=>e.stopPropagation()} onContextMenu={e=>e.preventDefault()}
    onPointerDown={e=>{
      e.stopPropagation();if(!natural.width)return;
      points.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
      e.currentTarget.setPointerCapture(e.pointerId);
      if(points.current.size===1){multi.current=false;gesture.current={kind:'pan',point:{x:e.clientX,y:e.clientY},start:current.current,time:Date.now()};}
      else if(points.current.size===2){multi.current=true;lastTap.current=null;gesture.current={kind:'pinch',distance:Math.max(1,distance()),anchor:midpoint(),start:current.current};}
      else {gesture.current=null;multi.current=true;}
    }}
    onPointerMove={e=>{
      e.stopPropagation();if(!points.current.has(e.pointerId))return;
      points.current.set(e.pointerId,{x:e.clientX,y:e.clientY});const g=gesture.current;if(!g)return;
      if(g.kind==='pinch'&&points.current.size===2)update(pinchImage(g.start,g.anchor,midpoint(),distance()/g.distance));
      else if(g.kind==='pan'&&points.current.size===1&&current.current.scale>1)update({...g.start,x:g.start.x+e.clientX-g.point.x,y:g.start.y+e.clientY-g.point.y});
    }}
    onPointerCancel={e=>{e.stopPropagation();clear();}}
    onPointerUp={e=>{
      e.stopPropagation();const g=gesture.current;if(!points.current.delete(e.pointerId))return;
      if(points.current.size){const point=[...points.current.values()][0];gesture.current={kind:'pan',point,start:current.current,time:Date.now()};return;}
      gesture.current=null;if(!g||multi.current||g.kind!=='pan')return;
      const dx=e.clientX-g.point.x,dy=e.clientY-g.point.y;
      if(current.current.scale<=1.01){const action=viewerSwipe(dx,dy);if(action){lastTap.current=null;onSwipe(action);return;}}
      if(Math.hypot(dx,dy)<12&&Date.now()-g.time<350){
        const tap=lastTap.current;
        if(tap&&Date.now()-tap.time<330&&Math.hypot(e.clientX-tap.point.x,e.clientY-tap.point.y)<32){
          const r=box.current!.getBoundingClientRect(),point={x:e.clientX-r.left-r.width/2,y:e.clientY-r.top-r.height/2};
          update(current.current.scale>1.01?initial:pinchImage(current.current,point,point,2));lastTap.current=null;
        }else lastTap.current={time:Date.now(),point:{x:e.clientX,y:e.clientY}};
      }else lastTap.current=null;
    }}>
    <img src={src} alt={alt} draggable={false} onLoad={e=>setNatural({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}
      style={{width:fit.width,height:fit.height,translate:`calc(-50% + ${value.x}px) calc(-50% + ${value.y}px)`,scale:value.scale}} />
  </div>;
});
