// src/lib/aerolux/bridge/preview.js
//
// this converts ableton's transport position into the local time within
// kinetic's editor

let active = null; // { effectId, effectStartBeat } | null

/**
    mark an effect as the one being currently previewed

@param {string} effectId
@param {number} absoluteBeat  ableton's current song position in beats
@param {number} effectStartBeat  where in the arrangement this effect's clip begins
*/
export function beginPreview(effectId, absoluteBeat, effectStartBeat) {
    active = { effectId, effectStartBeat };
    return onPreviewPosition(absoluteBeat);
}

/**
@param {number} absoluteBeat
@returns {{effectId:string, localBeat:number}|null}
*/
export function onPreviewPosition(absoluteBeat) {
    if (!active) return null;
    const localBeat = Math.max(0, absoluteBeat - active.effectStartBeat);
    return { effectId: active.effectId, localBeat };
}

export function endPreview() {
    const effectId = active?.effectId ?? null;
    active = null;
    return effectId;
}

export function isPreviewing() {
    return active !== null;
}

export function currentPreviewEffectId() {
    return active?.effectId ?? null;
}