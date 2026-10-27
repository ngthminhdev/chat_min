import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessage, chatKey, splitChatKey, normalizeContact } from './normalize.mjs';
const raw = (data = {}, extra = {}) => ({type: 0, threadId: '42', isSelf: false, data: {msgId:'9007199254740999', cliMsgId:'77', uidFrom:'42', ts:'1793000000000', dName:'Lan', msgType:'webchat', content:'Xin chào', ...data}, ...extra});
test('keeps provider IDs as strings and separates DM/group IDs', () => {
  assert.equal(chatKey(0, '42'), 'u:42'); assert.equal(chatKey(1, '42'), 'g:42');
  assert.deepEqual(splitChatKey('g:42'), {type:1, id:'42'});
  assert.throws(() => splitChatKey('https://chat.zalo.me/'));
  const m = normalizeMessage('zalo-a', raw(), 'me');
  assert.equal(m.id, '9007199254740999'); assert.equal(m.chatId, 'u:42'); assert.equal(m.sort,1793000000000);
  assert.equal(m.text, 'Xin chào'); assert.equal(m.outgoing,false);
});
test('normalizes quoted media without losing remote reference or quote IDs', () => {
  const m = normalizeMessage('zalo-a', raw({msgType:'chat.photo',content:{href:'https://a.zadn.vn/p.jpg',thumb:'https://a.zadn.vn/t.jpg',title:'Ảnh',params:JSON.stringify({width:640,height:480})},quote:{globalMsgId:'123',fromD:'Minh',msg:'trước'}}), 'me');
  assert.equal(m.kind,'media'); assert.equal(m.media.kind,'image'); assert.equal(m.media.width,640);
  assert.equal(m.media.fileRef,'https://a.zadn.vn/p.jpg'); assert.equal(m.replyTo,'123'); assert.equal(m.replyName,'Minh');
});
test('rejects malformed messages instead of inventing identities', () => {
  assert.throws(() => normalizeMessage('zalo-a',raw({msgId:''}),'me'));
  assert.throws(() => normalizeMessage('zalo-a',raw({ts:'invalid'}),'me'));
});
test('contacts are usable DM targets without claiming to be an inbox', () => {
  const c=normalizeContact({userId:'42',displayName:'Lan',avatar:'https://a.zadn.vn/a.jpg'});
  assert.deepEqual(c,{id:'u:42',name:'Lan',photo:'https://a.zadn.vn/a.jpg'});
});
test('legacy cached image/video fields retain downloadable URLs and geometry',()=>{
 const image=normalizeMessage('zalo-a',raw({msgType:'chat.photo',content:{oriUrl:'https://a.zdn.vn/original.jpg',normalUrl:'https://a.zdn.vn/normal.jpg',thumbUrl:'https://a.zdn.vn/thumb.jpg',params:JSON.stringify({width:640,height:480})}}),'me');
 assert.equal(image.media.fileRef,'https://a.zdn.vn/original.jpg');assert.equal(image.media.thumb,'https://a.zdn.vn/thumb.jpg');assert.equal(image.media.width,640);
 const video=normalizeMessage('zalo-a',raw({msgType:'chat.video.msg',content:{oriUrl:'https://a.dlmd.me/video.mp4',thumbUrl:'https://a.zdn.vn/thumb.jpg',params:{video_width:1920,video_height:1080}}}),'me');
 assert.equal(video.media.fileRef,'https://a.dlmd.me/video.mp4');assert.equal(video.media.width,1920);assert.equal(video.media.height,1080);
});
test('sticker IDs remain resolvable assets instead of empty file cards',()=>{
 const m=normalizeMessage('zalo-a',raw({msgType:'chat.sticker',content:{id:123,catId:4,type:7}}),'me');
 assert.equal(m.media.fileRef,'zalo-sticker:123');assert.equal(m.media.name,'Sticker.webp');assert.equal(m.media.width,128);
});
