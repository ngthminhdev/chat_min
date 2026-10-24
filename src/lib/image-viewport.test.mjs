import test from 'node:test';
import assert from 'node:assert/strict';
import { fitImage, constrainImage, pinchImage } from './image-viewport.ts';

test('portrait, landscape and panorama fit entirely inside the viewport', () => {
  for (const [w, h] of [[4000,3000],[3000,4000],[8000,1000],[1000,8000]]) {
    const fit=fitImage(420,794,w,h);
    assert.ok(fit.width<=420 && fit.height<=794);
    assert.ok(Math.abs(fit.width/fit.height-w/h)<0.001);
    assert.ok(Math.abs(fit.width-420)<0.001 || Math.abs(fit.height-794)<0.001);
  }
});

test('pan is bounded by the visible image and returning to fit recenters both axes', () => {
  const fit=fitImage(400,800,1600,1200);
  assert.deepEqual(constrainImage({scale:2,x:999,y:999},fit,{width:400,height:800}),{scale:2,x:200,y:0});
  assert.deepEqual(constrainImage({scale:0.5,x:999,y:-999},fit,{width:400,height:800}),{scale:1,x:0,y:0});
});

test('pinch keeps the point under the fingers stable and respects zoom limits', () => {
  const start={scale:1,x:0,y:0};
  assert.deepEqual(pinchImage(start,{x:20,y:30},{x:20,y:30},2),{scale:2,x:-20,y:-30});
  assert.equal(pinchImage(start,{x:0,y:0},{x:0,y:0},20).scale,4);
  assert.equal(pinchImage(start,{x:0,y:0},{x:0,y:0},0.1).scale,1);
});
