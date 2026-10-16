import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { ExpenseCreateOutcome, ExpenseCreateRequest, ExpenseSeasonOption } from "./expenses.repository.js";
import { ExpensesController } from "./expenses.controller.js";
import { configureSeasonApiObservability } from "../seasons/seasons-read.controller.js";

export type ExpensesDependencies = Readonly<{
  verify: (token: string) => Promise<VerifiedSubject | null>;
  create: (identity: VerifiedSubject, fieldId: string, request: ExpenseCreateRequest) => Promise<ExpenseCreateOutcome>;
  listAvailableSeasons: (identity: VerifiedSubject, fieldId: string) => Promise<ReadonlyArray<ExpenseSeasonOption>>;
}>;

const dependenciesKey = Symbol.for("EXPENSES_DEPENDENCIES");

export function createExpensesModule(dependencies: ExpensesDependencies): DynamicModule {
  @Module({ controllers: [ExpensesController], providers: [{ provide: dependenciesKey, useValue: dependencies }] })
  class ConfiguredExpensesModule {}
  return { module: ConfiguredExpensesModule };
}

export async function createExpensesApp(dependencies: ExpensesDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createExpensesModule(dependencies), new FastifyAdapter(), { logger: false });
  configureSeasonApiObservability(app);
  return app;
}
