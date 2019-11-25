// tslint:disable-next-line:no-implicit-dependencies
import * as ts from 'typescript'; // Imported for types alone
import { getWrapperUtils } from './wrapperUtils';
import { extname } from 'path';
import { wrapCompilerHost } from './wrapCompilerHost';

export interface TypeScriptPatchConfig {
  /**
   * Ususally, the compilerHost created with typescript.createWatchCompilerHost will bail out of diagnostics collection if there has been any syntactic error.
   * (see [`emitFilesAndReportErrors`](https://github.com/Microsoft/TypeScript/blob/89386ddda7dafc63cb35560e05412487f47cc267/src/compiler/watch.ts#L141) )
   * If this plugin is running with `checkSyntacticErrors: false`, this might lead to situations where no syntactic errors are reported within webpack
   * (because the file causing a syntactic error might not get processed by ts-loader), but there are semantic errors that would be missed due to this behavior.
   * This ensures that the compilerHost always assumes that there were no syntactic errors to be found and continues to check for semantic errors.
   */
  skipGetSyntacticDiagnostics: boolean;
  extensionHandlers: {
    [extension: string]: (
      originalContents: string,
      originalFileName: string
    ) => string;
  };
  wrapExtensions: string[];
  resolveModuleName?: string;
  resolveTypeReferenceDirective?: string;
}

/**
 * While it is often possible to pass a wrapped or modified copy of `typescript` or `typescript.sys` as a function argument to override/extend some typescript-internal behavior,
 * sometimes the typescript-internal code ignores these passed objects and directly references the internal `typescript` object reference.
 * In these situations, the only way of consistently overriding some behavior is to directly replace methods on the `typescript` object.
 *
 * So beware, this method directly modifies the passed `typescript` object!
 * @param typescript TypeScript instance to patch
 * @param config
 */
export function patchTypescript(
  typescript: typeof ts,
  config: TypeScriptPatchConfig
) {
  if (config.skipGetSyntacticDiagnostics) {
    patchSkipGetSyntacticDiagnostics(typescript);
  }
  patchCompilerHost(typescript, config);
  return typescript;
}

function patchCompilerHost(
  typescript: typeof ts,
  config: TypeScriptPatchConfig
) {
  const origTypescript = { ...typescript };
  const origSys = { ...origTypescript.sys };

  const { unwrapFileName } = getWrapperUtils(config);

  const handleFileContents = (
    originalFileName: string,
    originalContents?: string
  ) => {
    const handler = config.extensionHandlers[extname(originalFileName)];
    return handler && originalContents
      ? handler(originalContents, originalFileName)
      : originalContents;
  };

  const systemPatchedFunctions: Partial<ts.System> = {
    readFile(fileName, ...rest) {
      const originalFileName = unwrapFileName(fileName);
      return handleFileContents(
        originalFileName,
        origSys.readFile(fileName, ...rest)
      );
    }
  };

  const typescriptPatchedFunctions: Partial<typeof ts> = {
    createCompilerHost(options, setParentNodes) {
      return wrapCompilerHost(
        origTypescript.createCompilerHost(options, setParentNodes),
        options,
        typescript,
        config
      );
    },
    createWatchCompilerHost(
      fileOrFiles: any,
      options: ts.CompilerOptions | undefined,
      _system: any,
      ...args: any[]
    ) {
      if (!options) {
        throw new Error('CompilerOptions are required!');
      }
      return wrapCompilerHost(
        (origTypescript.createWatchCompilerHost as any)(
          fileOrFiles,
          options,
          typescript.sys,
          ...args
        ),
        options,
        typescript,
        config
      );
    },
    // function createEmitAndSemanticDiagnosticsBuilderProgram(newProgram: ts.Program, host: ts.BuilderProgramHost, oldProgram?: ts.EmitAndSemanticDiagnosticsBuilderProgram, configFileParsingDiagnostics?: ReadonlyArray<ts.Diagnostic>): ts.EmitAndSemanticDiagnosticsBuilderProgram;
    // function createEmitAndSemanticDiagnosticsBuilderProgram(rootNames: ReadonlyArray<string> | undefined, options: ts.CompilerOptions | undefined, host?: CompilerHost, oldProgram?: ts.EmitAndSemanticDiagnosticsBuilderProgram, configFileParsingDiagnostics?: ReadonlyArray<ts.Diagnostic>, projectReferences?: ReadonlyArray<ts.ProjectReference>): ts.EmitAndSemanticDiagnosticsBuilderProgram;
    createEmitAndSemanticDiagnosticsBuilderProgram(...args: any[]) {
      if (isTsProgram(args[0])) {
        throw new Error(
          "only the signature 'rootNames, options, host, ... is supported for createEmitAndSemanticDiagnosticsBuilderProgram"
        );
      }
      const origOptions = args[1];
      const origHost = args[2];

      args[2] = wrapCompilerHost(origHost, origOptions, typescript, config);
      return (origTypescript.createEmitAndSemanticDiagnosticsBuilderProgram as any)(
        ...args
      );
    }
  };

  Object.assign(typescript.sys, systemPatchedFunctions);
  Object.assign(typescript, typescriptPatchedFunctions);
}

/**
 * Overrides the [`typescript.createEmitAndSemanticDiagnosticsBuilderProgram`](https://github.com/Microsoft/TypeScript/blob/89386ddda7dafc63cb35560e05412487f47cc267/src/compiler/builder.ts#L1176)
 * method to return a `ts.Program` instance that does not emit syntactic errors,
 * to prevent the [`typescript.createWatchCompilerHost`](https://github.com/Microsoft/TypeScript/blob/89386ddda7dafc63cb35560e05412487f47cc267/src/compiler/watch.ts#L333)
 * method from bailing during diagnostic collection in the [`emitFilesAndReportErrors`](https://github.com/Microsoft/TypeScript/blob/89386ddda7dafc63cb35560e05412487f47cc267/src/compiler/watch.ts#L141) callback.
 *
 * See the description of TypeScriptPatchConfig.skipGetSyntacticDiagnostics and
 * [this github discussion](https://github.com/TypeStrong/fork-ts-checker-webpack-plugin/issues/257#issuecomment-485414182)
 * for further information on this problem & solution.
 */
function patchSkipGetSyntacticDiagnostics(typescript: typeof ts) {
  const {
    createEmitAndSemanticDiagnosticsBuilderProgram: originalCreateEmitAndSemanticDiagnosticsBuilderProgram
  } = typescript;

  const patchedMethods: Pick<
    typeof ts,
    'createEmitAndSemanticDiagnosticsBuilderProgram'
  > = {
    createEmitAndSemanticDiagnosticsBuilderProgram(...args: any[]) {
      const program = originalCreateEmitAndSemanticDiagnosticsBuilderProgram.apply(
        typescript,
        args as any
      );
      program.getSyntacticDiagnostics = () => [];
      return program;
    }
  };

  // directly patch the typescript object!
  Object.assign(typescript, patchedMethods);
}

function isTsProgram(
  x: ReadonlyArray<string> | undefined | ts.Program
): x is ts.Program {
  return !!x && 'getRootFileNames' in x;
}
