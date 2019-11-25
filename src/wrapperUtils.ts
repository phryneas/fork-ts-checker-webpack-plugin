// tslint:disable-next-line:no-implicit-dependencies
import { extname } from 'path';
import { TypeScriptPatchConfig } from './patchTypescript';

export interface WrapperUtils {
  wrapFileName(fileName: string): string;
  unwrapFileName(fileName: string): string;
}

export function getWrapperUtils(config: TypeScriptPatchConfig) {
  const SUFFIX_TS = '.__fake__.ts';
  return {
    watchExtensions: ['.ts', '.tsx', ...config.wrapExtensions],

    wrapFileName(fileName: string) {
      return config.wrapExtensions.some(ext => fileName.endsWith(ext))
        ? fileName.concat(SUFFIX_TS)
        : fileName;
    },

    unwrapFileName(fileName: string) {
      if (fileName.endsWith(SUFFIX_TS)) {
        const realFileName = fileName.slice(0, -SUFFIX_TS.length);
        if (config.wrapExtensions.includes(extname(realFileName))) {
          return realFileName;
        }
      }
      return fileName;
    }
  };
}
