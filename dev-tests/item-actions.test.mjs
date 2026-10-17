import test from 'node:test';
import assert from 'node:assert/strict';
import { postItemToChat } from '../scripts/item-actions.js';

test('chat uses the exact embedded Item native method, deduplicates in-flight clicks and permits retry', async () => {
  let calls = 0, release;
  const item = {sendToChat() {assert.equal(this, item); calls++; return new Promise(resolve => {release = resolve;});}};
  const actor = {isOwner: true, items: new Map([['item', item]])};
  const first = postItemToChat(actor, 'item'), second = postItemToChat(actor, 'item');
  assert.equal(first, second); await Promise.resolve(); assert.equal(calls, 1);
  release('native card'); assert.equal(await first, 'native card');
  const third = postItemToChat(actor, 'item'); await Promise.resolve(); release(); await third;
  assert.equal(calls, 2);
});
test('foreign, removed and unsupported chat Items fail without fallback messages', async () => {
  const actor = {isOwner: false, items: new Map([['item', {sendToChat() {throw Error('must not execute');}}]])};
  await assert.rejects(postItemToChat(actor, 'item'), /недоступна/);
  actor.isOwner = true;
  await assert.rejects(postItemToChat(actor, 'foreign'), /недоступна/);
  actor.items.set('unsupported', {});
  await assert.rejects(postItemToChat(actor, 'unsupported'), /недоступна/);
});
test('failed native posting propagates and releases its retry guard', async () => {
  let calls = 0;
  const actor = {isOwner: true, items: new Map([['item', {sendToChat() {calls++; throw Error('native permissions');}}]])};
  await assert.rejects(postItemToChat(actor, 'item'), /native permissions/);
  await assert.rejects(postItemToChat(actor, 'item'), /native permissions/);
  assert.equal(calls, 2);
});
