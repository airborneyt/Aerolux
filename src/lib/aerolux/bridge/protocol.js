// src/lib/aerolux/bridge/protocol.js
// this is the message envelope and schema for Aerolux Bridge (m4l link)

export const PROTOCOL_VERSION = 1;

export const MESSAGE_TYPES = Object.freeze({
    CONNECTION_HELLO: 'connection.hello',
    CONNECTION_ACK:   'connection.ack',
    CONNECTION_PING:  'connection.ping',
    CONNECTION_PONG:  'connection.pong',

    TRANSPORT_STATE:    'transport.state',
    TRANSPORT_POSITION: 'transport.position',
    TRANSPORT_SET:      'transport.set',

    CLIP_CREATE:  'clip.create',
    CLIP_CREATED: 'clip.created',
    CLIP_UPDATE:  'clip.update',
    CLIP_UPDATED: 'clip.updated',
    CLIP_DELETE:  'clip.delete',
    CLIP_DELETED: 'clip.deleted',
    CLIP_LINK:    'clip.link',
    CLIP_LINKED:  'clip.linked',
    CLIP_UNLINK:  'clip.unlink',
    CLIP_UNLINKED:'clip.unlinked',
    CLIP_IMPORT:  'clip.import',

    PREVIEW_BEGIN:    'preview.begin',
    PREVIEW_POSITION: 'preview.position',
    PREVIEW_END:      'preview.end',

    SESSION_REQUEST: 'session.request',
    SESSION_STATE:   'session.state',

    ERROR: 'error',
});

const VALID_TYPES = new Set(Object.values(MESSAGE_TYPES));

function makeId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
    builds a protocol-conformant message envelope

@param {string} type: one of MESSAGE_TYPES
@param {object} [payload]
@returns {{protocol:string, version:number, id:string, type:string, payload:object}}
*/
export function makeMessage(type, payload = {}) {
    if (!VALID_TYPES.has(type)) {
        throw new Error(`AeroFlux: unknown message type "${type}"`);
    }
    return {
        protocol: 'aerolux-bridge',
        version: PROTOCOL_VERSION,
        id: makeId(),
        type,
        payload,
    };
}

/**
    validate an incoming message shape before it is trusted anywhere else in
    the bridge to avoid any false calls
    if there is an error it is returned as a result

@param {*} raw
@returns {{ok:true, message:object} | {ok:false, reason:string}}
*/
export function validateMessage(raw) {
    if (!raw || typeof raw !== 'object') {
        return { ok: false, reason: 'Message is not an object.' };
    }
    if (raw.protocol !== 'aerolux-bridge') {
        return { ok: false, reason: `Unexpected protocol "${raw.protocol}".` };
    }
    if (typeof raw.version !== 'number') {
        return { ok: false, reason: 'Missing/invalid version.' };
    }
    if (raw.version !== PROTOCOL_VERSION) {
        // forward compatibility
        return { ok: false, reason: `Protocol version mismatch: got ${raw.version}, expected ${PROTOCOL_VERSION}.` };
    }
    if (typeof raw.id !== 'string' || !raw.id) {
        return { ok: false, reason: 'Missing message id.' };
    }
    if (!VALID_TYPES.has(raw.type)) {
        return { ok: false, reason: `Unknown message type "${raw.type}".` };
    }
    if (raw.payload !== undefined && typeof raw.payload !== 'object') {
        return { ok: false, reason: 'payload must be an object.' };
    }
    return { ok: true, message: raw };
}

// convenience function that builds a well-formed error message replying to 
// a given request id
export function makeErrorMessage(inReplyToId, reason) {
    return makeMessage(MESSAGE_TYPES.ERROR, { inReplyToId, reason });
}