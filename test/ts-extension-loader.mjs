export async function resolve(specifier, context, nextResolve) {
  const isExtensionlessRelativeImport =
    /^\.{1,2}\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier);

  if (!isExtensionlessRelativeImport) {
    return nextResolve(specifier, context);
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return nextResolve(`${specifier}.ts`, context);
  }
}
