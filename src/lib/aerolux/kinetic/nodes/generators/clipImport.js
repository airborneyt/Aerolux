import { nullField } from "../../field";
import { getDeviceGrid } from "../../sampleDevice";
import { clipToField } from "../../clipImport";

export function createClipImportField(params, context, inputField, inputFieldB, resolveParam) {
    const { clipData = null } = params;
    if (!clipData) return nullField;
    const grid = getDeviceGrid();
    return clipToField(clipData, grid, context, params, resolveParam);
}