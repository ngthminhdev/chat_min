export interface ImageTransform { scale: number; x: number; y: number }
export interface ImageSize { width: number; height: number }
export interface ImagePoint { x: number; y: number }

export function fitImage(width: number, height: number, naturalWidth: number, naturalHeight: number): ImageSize {
  if (Math.min(width, height, naturalWidth, naturalHeight)<=0) return {width:0,height:0};
  const scale=Math.min(width/naturalWidth,height/naturalHeight);
  return {width:Math.min(width,naturalWidth*scale),height:Math.min(height,naturalHeight*scale)};
}

export function constrainImage(value: ImageTransform, fit: ImageSize, viewport: ImageSize): ImageTransform {
  const scale=Math.max(1,Math.min(4,value.scale));
  const maxX=Math.max(0,(fit.width*scale-viewport.width)/2);
  const maxY=Math.max(0,(fit.height*scale-viewport.height)/2);
  return {scale,x:maxX ? Math.max(-maxX,Math.min(maxX,value.x)) : 0,y:maxY ? Math.max(-maxY,Math.min(maxY,value.y)) : 0};
}

export function pinchImage(start: ImageTransform, anchor: ImagePoint, midpoint: ImagePoint, ratio: number): ImageTransform {
  const scale=Math.max(1,Math.min(4,start.scale*ratio)), change=scale/start.scale;
  return {scale,x:midpoint.x-(anchor.x-start.x)*change,y:midpoint.y-(anchor.y-start.y)*change};
}
