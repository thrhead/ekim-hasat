import { Module, type DynamicModule } from "@nestjs/common";
import type { PrismaClient } from "../generated/prisma/client.js";
import { PrismaExistingFieldRegionRepository, ResolveExistingFieldRegionService } from "../fields/resolve-existing-field-region.service.js";
import { UnavailableRegionResolver } from "./unavailable-region-resolver.js";
import type { RegionResolverPort } from "./region-resolver.port.js";

export const REGION_RESOLVER_PORT = Symbol("REGION_RESOLVER_PORT");
export const EXISTING_FIELD_REGION_RESOLUTION = Symbol("EXISTING_FIELD_REGION_RESOLUTION");

export type RegionsModuleDependencies = Readonly<{
  prisma: PrismaClient;
  resolver?: RegionResolverPort;
}>;

/** Provider-neutral resolver composition; production stays explicitly unavailable until qualification. */
export function createRegionsModule(dependencies: RegionsModuleDependencies): DynamicModule {
  const resolver = dependencies.resolver ?? new UnavailableRegionResolver();
  @Module({
    providers: [
      { provide: REGION_RESOLVER_PORT, useValue: resolver },
      {
        provide: EXISTING_FIELD_REGION_RESOLUTION,
        useFactory: (port: RegionResolverPort) => new ResolveExistingFieldRegionService(
          new PrismaExistingFieldRegionRepository(dependencies.prisma), port,
        ),
        inject: [REGION_RESOLVER_PORT],
      },
    ],
    exports: [REGION_RESOLVER_PORT, EXISTING_FIELD_REGION_RESOLUTION],
  })
  class ConfiguredRegionsModule {}
  return { module: ConfiguredRegionsModule };
}
