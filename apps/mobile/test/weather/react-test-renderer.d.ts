declare module "react-test-renderer" {
  import type { ReactElement } from "react";

  export interface TestRenderer {
    readonly root: {
      findAll(predicate: (node: { props: Record<string, unknown> }) => boolean): Array<{ props: Record<string, unknown> }>;
    };
    update(element: ReactElement): void;
    unmount(): void;
  }

  export function act(callback: () => void): void;
  export function create(element: ReactElement): TestRenderer;
}
