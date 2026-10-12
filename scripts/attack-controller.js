/** Bind only this invocation's native Application; tag its roll options, not the
 * next vaguely matching chat message. FL Firearms and RDP retain their handlers.
 */
export function createAttackController({operations, rolls, getActor, onChange = () => {}}) {
  const opening = new Set();
  async function launch({actorUuid, itemId, equipmentRevision, weaponRevision, cost, combat}) {
    if (opening.has(actorUuid)) throw new Error("Диалог атаки этого персонажа уже открыт.");
    opening.add(actorUuid); onChange();
    const id = foundry.utils.randomID();
    let app = null, executing = false, committed = false, prepared = false, closed = false, execution = null;
    const marker = {id, actorUuid, itemId, combat: combat ?? null};
    const notify = error => ui.notifications?.error?.(error.message ?? String(error));
    const closeHook = Hooks.on("closeApplication", candidate => {if (candidate === app && !committed) closed = true;});
    const hook = Hooks.on("renderApplication", candidate => {
      if (app || candidate.options?.yzeWidgetIntent !== id || typeof candidate.getRollOptions !== "function" || typeof candidate.executeRoll !== "function") return;
      const actor = getActor();
      if (actor?.uuid !== actorUuid) return;
      const options = candidate.getRollOptions();
      const ids = Array.isArray(options?.itemId) ? options.itemId : [options?.itemId];
      if (options?.actorId !== actor.id || options.isAttack !== true || !ids.includes(itemId) ||
          actor.isToken && (options.tokenId !== actor.token?.id || options.sceneId !== actor.token?.parent?.id)) return;
      app = candidate;
      const getOptions = app.getRollOptions, nativeExecute = app.executeRoll;
      app.getRollOptions = function (...args) {
        const options = getOptions.apply(this, args);
        return executing ? {...options, yzeWidgetAttack: {...marker}} : options;
      };
      app.executeRoll = function (...args) {
        if (execution) return execution; // Duplicate submits wait for the same result.
        execution = (async () => {
          executing = true;
          try {
            if (getActor()?.uuid !== actorUuid) throw new Error("Выбранный персонаж изменился. Откройте новую атаку.");
            const reservation = await operations.request({kind: "reserveAttack", actorUuid, id});
            if (reservation.operation.phase !== "rolling") throw new Error("Эта атака уже завершена или отменена.");
            if (closed) {
              committed = true;
              await operations.request({kind: "cancel", actorUuid, id, verifyNoRoll: true});
              return null;
            }
            const result = await nativeExecute.apply(this, args);
            committed = true;
            if (result?.message?.id) {
              try { await operations.request({kind: "confirmAttack", actorUuid, id, messageId: result.message.id}); }
              catch (error) { notify(error); } // Keep the successful native result; recovery never rolls again.
            } else {
              await operations.request({kind: "cancel", actorUuid, id, verifyNoRoll: true});
            }
            return result;
          } catch (error) {
            committed = true;
            try { await operations.request({kind: "cancel", actorUuid, id, verifyNoRoll: true}); }
            catch (recoveryError) { notify(recoveryError); }
            throw error;
          } finally { executing = false; onChange(); }
        })();
        return execution;
      };
    });
    try {
      await operations.request({kind: "prepareAttack", actorUuid, itemId, id, equipmentRevision, weaponRevision, cost, combat});
      prepared = true;
      const result = await rolls.open({kind: "attack", actorUuid, itemId, expectedRevision: equipmentRevision, intentId: id});
      if (!app || !committed) {
        await operations.request({kind: "cancel", actorUuid, id});
        if (result?.message) throw new Error("Диалог не поддерживает подтверждение виджета. Проверьте бросок и отметьте стоимость вручную.");
      }
      return result;
    } catch (error) {
      if (prepared && !executing) {
        try { await operations.request({kind: "cancel", actorUuid, id, verifyNoRoll: true}); }
        catch (recoveryError) { notify(recoveryError); }
      }
      if (/^Roll cancelled$/i.test(error.message ?? "")) return null;
      throw error;
    } finally {
      if (execution) await execution.catch(() => {});
      Hooks.off("renderApplication", hook);
      Hooks.off("closeApplication", closeHook);
      opening.delete(actorUuid); onChange();
    }
  }
  return Object.freeze({launch, isOpen: uuid => opening.has(uuid)});
}
