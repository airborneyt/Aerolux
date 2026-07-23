import { nullField } from "../../field";
import { getDeviceGrid } from "../../sampleDevice";
import { clipToField } from "../../clipImport";

export function createClipImportField(params) {
    const { clipData = null, timeStretch = 1, transpose = 0 } = params;
    if (!clipData) return nullField;
    const grid = getDeviceGrid();
    return clipToField(clipData, grid, { timeStretch, transpose });
}