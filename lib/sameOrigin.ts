function firstHeaderValue(value: string | null): string | undefined {
  return value?.split(",", 1)[0]?.trim() || undefined;
}

export function isSameOriginRequest(request: Request): boolean {
  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin) return true;

  try {
    const supplied = new URL(suppliedOrigin);
    const requestUrl = new URL(request.url);
    const expectedHost = firstHeaderValue(request.headers.get("host")) ?? requestUrl.host;
    const forwardedProtocol = firstHeaderValue(request.headers.get("x-forwarded-proto"));
    const expectedProtocol = forwardedProtocol ? `${forwardedProtocol}:` : requestUrl.protocol;

    return supplied.host === expectedHost && supplied.protocol === expectedProtocol;
  } catch {
    return false;
  }
}
