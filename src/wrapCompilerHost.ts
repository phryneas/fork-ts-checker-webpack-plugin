/* tslint:disable:no-console */
// tslint:disable-next-line:no-implicit-dependencies
import * as ts from 'typescript'; // Imported for types alone
import { TypeScriptWrapperConfig } from './wrapperUtils';

type HostType = ts.CompilerHost | ts.WatchCompilerHostOfConfigFile<any>;
// @ts-ignore
type ScriptKindName =
  | 'Unknown'
  | 'JS'
  | 'JSX'
  | 'TS'
  | 'TSX'
  | 'External'
  | 'JSON'
  | 'Deferred';

export function wrapCompilerHost<T extends HostType>(
  host: T,
  compilerOptions: ts.CompilerOptions,
  typescript: typeof ts,
  _config: TypeScriptWrapperConfig
) {
  const wrapSuffixes = ['', '.__fake__'];

  const that = { ...host };

  const compilerHostWrappers: Partial<ts.CompilerHost> = {
    resolveModuleNames(
      this: ts.CompilerHost,
      moduleNames,
      containingFile,
      _reusedNames, // no idea what this is for
      redirectedReference
    ) {
      return moduleNames.map(moduleName => {
        for (const suffix of wrapSuffixes) {
          /*
          console.log(
            START_YELLOW,
            'try resolving',
            moduleName + suffix,
            RESET
          );
          */
          const result = typescript.resolveModuleName(
            moduleName + suffix,
            containingFile,
            compilerOptions,
            this,
            undefined,
            redirectedReference
          );
          if (result.resolvedModule) {
            /*
            console.log(
              START_YELLOW,
              'resolved',
              moduleName,
              'as',
              result.resolvedModule.resolvedFileName,
              RESET
            );
            */
            return result.resolvedModule;
          }
        }
        // console.log(START_RED, 'could not revolve', moduleName, RESET);
        return undefined;
      });
    },
    getSourceFile(this: ts.CompilerHost, ...args) {
      let result = (that as ts.CompilerHost) /* TODO: undo "this" handling just about everywhere */
        .getSourceFile(...args);
      if (result && result.text) {
        const matches = /^\s*\/\*\s*@fork-ts-checker-handle-file-as\s+(Unknown|JS|JSX|TS|TSX|External|JSON|Deferred)\s*\*\//.exec(
          result.text
        );
        if (matches) {
          const scriptKind = matches[1] as ScriptKindName;
          result = typescript.createSourceFile(
            result.fileName,
            result.text,
            result.languageVersion,
            true,
            ts.ScriptKind[scriptKind]
          );
        }
        /*
        console.log(
          'getSourceFile =>',
          result.fileName,
          ts.ScriptKind[(result as any).scriptKind]
        );
        */
      }
      return result;
    }
  };

  const handler: ProxyHandler<HostType> = {
    get(target, name: string) {
      if (
        compilerHostWrappers[name] &&
        target[name] &&
        name !== 'getSourceFile2'
      ) {
        if (typeof compilerHostWrappers[name] === 'function') {
          return compilerHostWrappers[name].bind(target);
        }
        return compilerHostWrappers[name];
      }
      return target[name];
    }
  };

  return new Proxy<T>(host, handler);
}

// @ts-ignore
const START_YELLOW = '\x1b[33m';
// @ts-ignore
const START_RED = '\x1b[31m';
// @ts-ignore
const RESET = '\x1b[0m';
