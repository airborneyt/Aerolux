// src/lib/aerolux/audio/assets/registry.js

/**
@param {string} kind  label used in the redefinition warning
*/
export function createRegistry(kind) {
    const map = new Map();
    return {
        define(id, value) {
            if (map.has(id)) {
                console.warn(`[audio] ${kind} "${id}" redefined. Overwriting the previous definition.`);
            }
            map.set(id, value);
            return value;
        },
        get(id) { return map.get(id) ?? null; },
        has(id) { return map.has(id); },
        list() { return [...map.values()]; },
        ids() { return [...map.keys()]; },
        clear() { map.clear(); },
    };
}