export function prepareErrorForSerialization(e: any) {
  const prepared = {
    message: 'unkonwn error',
    stack: 'no stack trace available',
    fileName: 'unknown',
    lineNumber: 'unknown',
    columnNumber: 'unknown'
  };

  if (e) {
    if (typeof e === 'string') {
      prepared.message = e;
    } else {
      for (const key of Object.keys(prepared)) {
        if (typeof e[key] !== 'undefined') {
          prepared[key] = String(e[key]);
        }
      }
    }
  }

  return prepared;
}
