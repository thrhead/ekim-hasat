import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { IrrigationRecordCreateOutcome, IrrigationRecordCreateRequest } from "./irrigation-records.repository.js";
import { IrrigationRecordsController } from "./irrigation-records.controller.js";
import { configureSeasonApiObservability } from "../seasons/seasons-read.controller.js";

export type IrrigationRecordsDependencies = Readonly<{
  verify: (token: string) => Promise<VerifiedSubject | null>;
  create: (identity: VerifiedSubject, fieldId: string, request: IrrigationRecordCreateRequest) => Promise<IrrigationRecordCreateOutcome>;
}>;

const dependenciesKey = Symbol.for("IRRIGATION_RECORDS_DEPENDENCIES");

export function createIrrigationRecordsModule(dependencies: IrrigationRecordsDependencies): DynamicModule {
  @Module({ controllers: [IrrigationRecordsController], providers: [{ provide: dependenciesKey, useValue: dependencies }] })
  class ConfiguredIrrigationRecordsModule {}
  return { module: ConfiguredIrrigationRecordsModule };
}

export async function createIrrigationRecordsApp(dependencies: IrrigationRecordsDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createIrrigationRecordsModule(dependencies), new FastifyAdapter(), { logger: false });
  configureSeasonApiObservability(app);
  return app;
}
