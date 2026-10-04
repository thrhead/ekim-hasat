import { Module, type DynamicModule } from "@nestjs/common";
import type { FieldsReadDependencies } from "./fields-read.controller.js";
import { createFieldsReadModule } from "./fields-read.controller.js";
import type { FieldCreateDependencies } from "./fields-create.controller.js";
import { createFieldCreateModule } from "./fields-create.controller.js";
import type { FieldUpdateDependencies } from "./fields-update.controller.js";
import { createFieldUpdateModule } from "./fields-update.controller.js";

export type FieldsModuleDependencies = Readonly<{
  read: FieldsReadDependencies;
  create: FieldCreateDependencies;
  update: FieldUpdateDependencies;
}>;

/** The bounded Fields feature composition; root API registration remains in main.ts. */
export function createFieldsModule(dependencies: FieldsModuleDependencies): DynamicModule {
  @Module({ imports: [
    createFieldsReadModule(dependencies.read),
    createFieldCreateModule(dependencies.create),
    createFieldUpdateModule(dependencies.update),
  ] })
  class ConfiguredFieldsModule {}
  return { module: ConfiguredFieldsModule };
}
