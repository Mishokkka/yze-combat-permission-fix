const posting = new WeakMap();

/** Use FBL's native chat card, visibility flags and roll mode, once per click. */
export function postItemToChat(actor, itemId) {
  const item = actor?.items?.get(itemId);
  if (!actor?.isOwner || !item || typeof item.sendToChat !== "function") {
    return Promise.reject(new Error("Отправка этого предмета в чат недоступна."));
  }
  if (posting.has(item)) return posting.get(item);
  const task = Promise.resolve().then(() => item.sendToChat());
  posting.set(item, task);
  const cleanup = () => { if (posting.get(item) === task) posting.delete(item); };
  task.then(cleanup, cleanup);
  return task;
}
