import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = Readonly<{
  correlationId: string;
  method: string;
}>;

const requestContext = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, operation: () => T): T {
  return requestContext.run(context, operation);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}
