import * as process from 'process';
import * as mockRequire from 'mock-require';

import { getWrapperUtils, WrapperUtils } from './wrapperUtils';
import { handleVueContentBuilder } from './handleVueContents';

let patchConfig: TypeScriptPatchConfig = {
  skipGetSyntacticDiagnostics:
    process.env.USE_INCREMENTAL_API === 'true' &&
    process.env.CHECK_SYNTACTIC_ERRORS !== 'true',

  extensionHandlers: {},
  wrapExtensions: [],
  resolveModuleName: process.env.RESOLVE_MODULE_NAME,
  resolveTypeReferenceDirective: process.env.RESOLVE_TYPE_REFERENCE_DIRECTIVE
};

const vueOptions: VueOptions = JSON.parse(process.env.VUE!);

let wrapperUtils: WrapperUtils | null = null;

if (vueOptions.enabled) {
  const handleVueContents = handleVueContentBuilder(vueOptions);
  patchConfig = {
    ...patchConfig,
    extensionHandlers: {
      '.vue': handleVueContents,
      '.vuex': handleVueContents
    },
    wrapExtensions: ['.vue', '.vuex']
  };

  wrapperUtils = getWrapperUtils(patchConfig);

  // mock the "fs" module
  mockRequire(
    'fs',
    require('./fakeExtensionFs').build(
      require('fs'),
      wrapperUtils.unwrapFileName,
      wrapperUtils.wrapFileName
    )
  );
  mockRequire.reRequire('fs');
}

// now continue with everything as normal
// tslint:disable-next-line:no-implicit-dependencies
import * as ts from 'typescript'; // import for types alone

import { IncrementalChecker } from './IncrementalChecker';
import { CancellationToken } from './CancellationToken';
import { NormalizedMessage } from './NormalizedMessage';
import {
  IncrementalCheckerInterface,
  ApiIncrementalCheckerParams,
  IncrementalCheckerParams
} from './IncrementalCheckerInterface';
import { ApiIncrementalChecker } from './ApiIncrementalChecker';
import {
  makeCreateNormalizedMessageFromDiagnostic,
  makeCreateNormalizedMessageFromRuleFailure,
  makeCreateNormalizedMessageFromInternalError
} from './NormalizedMessageFactories';

import { RpcProvider } from 'worker-rpc';
import { RunPayload, RunResult, RUN } from './RpcTypes';
import { TypeScriptPatchConfig, patchTypescript } from './patchTypescript';
import { createEslinter } from './createEslinter';
import { VueOptions } from './types/vue-options';

const rpc = new RpcProvider(message => {
  try {
    process.send!(message, undefined, undefined, error => {
      if (error) {
        process.exit();
      }
    });
  } catch (e) {
    // channel closed...
    process.exit();
  }
});
process.on('message', message => rpc.dispatch(message));

const typescript: typeof ts = require(process.env.TYPESCRIPT_PATH!);

patchTypescript(typescript, patchConfig);

// message factories
export const createNormalizedMessageFromDiagnostic = makeCreateNormalizedMessageFromDiagnostic(
  typescript
);
export const createNormalizedMessageFromRuleFailure = makeCreateNormalizedMessageFromRuleFailure();
export const createNormalizedMessageFromInternalError = makeCreateNormalizedMessageFromInternalError();

const eslinter =
  process.env.ESLINT === 'true'
    ? createEslinter(JSON.parse(process.env.ESLINT_OPTIONS!))
    : undefined;

function createChecker(
  useIncrementalApi: boolean
): IncrementalCheckerInterface {
  const apiIncrementalCheckerParams: ApiIncrementalCheckerParams = {
    typescript,
    context: process.env.CONTEXT!,
    programConfigFile: process.env.TSCONFIG!,
    compilerOptions: JSON.parse(process.env.COMPILER_OPTIONS!),
    createNormalizedMessageFromDiagnostic,
    linterConfigFile:
      process.env.TSLINT === 'true' ? true : process.env.TSLINT! || false,
    linterAutoFix: process.env.TSLINTAUTOFIX === 'true',
    createNormalizedMessageFromRuleFailure,
    eslinter,
    checkSyntacticErrors: process.env.CHECK_SYNTACTIC_ERRORS === 'true'
  };

  if (useIncrementalApi) {
    return new ApiIncrementalChecker(apiIncrementalCheckerParams);
  }

  const incrementalCheckerParams: IncrementalCheckerParams = Object.assign(
    {},
    apiIncrementalCheckerParams,
    {
      watchPaths: process.env.WATCH === '' ? [] : process.env.WATCH!.split('|'),
      workNumber: parseInt(process.env.WORK_NUMBER!, 10) || 0,
      workDivision: parseInt(process.env.WORK_DIVISION!, 10) || 1
    }
  );

  return new IncrementalChecker(incrementalCheckerParams);
}

const checker = createChecker(process.env.USE_INCREMENTAL_API === 'true');

async function run(cancellationToken: CancellationToken) {
  let diagnostics: NormalizedMessage[] = [];
  let lints: NormalizedMessage[] = [];

  try {
    checker.nextIteration();

    diagnostics = await checker.getDiagnostics(cancellationToken);
    if (checker.hasEsLinter()) {
      lints = checker.getEsLints(cancellationToken);
    } else if (checker.hasLinter()) {
      lints = checker.getLints(cancellationToken);
    }

    if (wrapperUtils !== null) {
      const wrapUtils = wrapperUtils;
      lints = lints.map(lint => {
        if (lint.file) {
          const unwrappedFileName = wrapUtils.unwrapFileName(lint.file);

          if (unwrappedFileName !== lint.file) {
            return new NormalizedMessage({
              ...lint.toJSON(),
              file: unwrappedFileName
            });
          }
        }
        return lint;
      });

      diagnostics = diagnostics.map(diagnostic => {
        if (diagnostic.file) {
          const unwrappedFileName = wrapUtils.unwrapFileName(diagnostic.file);

          if (unwrappedFileName !== diagnostic.file) {
            return new NormalizedMessage({
              ...diagnostic.toJSON(),
              file: unwrappedFileName
            });
          }
        }
        return diagnostic;
      });
    }
  } catch (error) {
    if (error instanceof typescript.OperationCanceledException) {
      return undefined;
    }

    diagnostics.push(createNormalizedMessageFromInternalError(error));
  }

  if (cancellationToken.isCancellationRequested()) {
    return undefined;
  }

  return {
    diagnostics,
    lints
  };
}

rpc.registerRpcHandler<RunPayload, RunResult>(RUN, message =>
  typeof message !== 'undefined'
    ? run(CancellationToken.createFromJSON(typescript, message!))
    : undefined
);

process.on('SIGINT', () => {
  process.exit();
});
