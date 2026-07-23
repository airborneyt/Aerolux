// src/lib/aerolux/kinetic/nodes/utility/logic.js
// allows users to use operands on two inputs to merge/filter them.

// logic differs from blend as it applies colour masking rather than depth/layer masking.

import { clamp63 } from "../../sharedHelpers";

export function createLogicField(params, context, inputField, inputFieldB, resolveParam) {
    const { operation = 'and', compareMode = 'eq' } = params;

    return {
      kind: 'stateless',
      sample(x, y, t) {
        const a = inputField ? inputField.sample(x, y, t) : null;
        const b = inputFieldB ? inputFieldB.sample(x, y, t) : null;

        if (!a && !b) return null;
        if (!a) return b;
        if (!b) return a;

        const [r1, g1, b1] = a;
        const [r2, g2, b2] = b;
        
        const toBoolean = (val) => val ? 63 : 0;
        
        let rRes, gRes, bRes;

        switch (operation) {
          case 'and':
            rRes = (toBoolean(r1) && toBoolean(r2)) ? 63 : 0;
            gRes = (toBoolean(g1) && toBoolean(g2)) ? 63 : 0;
            bRes = (toBoolean(b1) && toBoolean(b2)) ? 63 : 0;
            break;

          case 'or':
            rRes = (toBoolean(r1) || toBoolean(r2)) ? 63 : 0;
            gRes = (toBoolean(g1) || toBoolean(g2)) ? 63 : 0;
            bRes = (toBoolean(b1) || toBoolean(b2)) ? 63 : 0;
            break;

          case 'not':
            // apply NOT to the primary input field (a). if b is present, ignore it for 'not' logic unless specified otherwise.
            // standard boolean NOT: true -> false, false -> true.
            rRes = toBoolean(r1) ? 0 : 63;
            gRes = toBoolean(g1) ? 0 : 63;
            bRes = toBoolean(b1) ? 0 : 63;
            break;

          case 'xor':
            rRes = (toBoolean(r1) ^ toBoolean(r2)) ? 63 : 0;
            gRes = (toBoolean(g1) ^ toBoolean(g2)) ? 63 : 0;
            bRes = (toBoolean(b1) ^ toBoolean(b2)) ? 63 : 0;
            break;

          case 'compare':
            // compare a against b based on mode
            const val1 = toBoolean(r1);
            const val2 = toBoolean(r2);
            if (compareMode === 'eq') rRes = val1 === val2 ? 63 : 0;
            else if (compareMode === 'gt') rRes = val1 > val2 ? 63 : 0;
            else if (compareMode === 'lt') rRes = val1 < val2 ? 63 : 0;
            else if (compareMode === 'gte') rRes = val1 >= val2 ? 63 : 0;
            else if (compareMode === 'lte') rRes = val1 <= val2 ? 63 : 0;

            gRes = (compareMode === 'eq' ? g1 === g2 : 
                     compareMode === 'gt' ? g1 > g2 : 
                     compareMode === 'lt' ? g1 < g2 : 
                     compareMode === 'gte' ? g1 >= g2 : 
                     compareMode === 'lte' ? g1 <= g2 : false) ? 63 : 0;
            
            bRes = (compareMode === 'eq' ? b1 === b2 : 
                     compareMode === 'gt' ? b1 > b2 : 
                     compareMode === 'lt' ? b1 < b2 : 
                     compareMode === 'gte' ? b1 >= b2 : 
                     compareMode === 'lte' ? b1 <= b2 : false) ? 63 : 0;
            break;

          default:
            rRes = r1; gRes = g1; bRes = b1;
        }

        return [
          clamp63(rRes),
          clamp63(gRes),
          clamp63(bRes),
        ];
      },
    };
  }