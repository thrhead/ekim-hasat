import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { createSpec014GuardedPool } from "./spec014-guarded-pool.js";

export async function createManualTaskFixture(options: { validated?: boolean } = {}) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = createSpec014GuardedPool(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const businessId = randomUUID(), foreignBusinessId = randomUUID(), fieldId = randomUUID(), seasonId = randomUUID(), planId = randomUUID();
  const cropId = randomUUID(), templateId = randomUUID(), legacyTaskId = randomUUID(), provider = `spec014-${randomUUID()}`;
  const users = Object.fromEntries(["OWNER", "WORKER", "ADVISOR", "FOREIGN"].map(role => [role, { id: randomUUID(), member: randomUUID(), identity: { provider, subject: role } }]));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO businesses(id) VALUES ($1),($2)", [businessId, foreignBusinessId]);
    for (const [role, user] of Object.entries(users)) {
      const business = role === "FOREIGN" ? foreignBusinessId : businessId;
      await client.query("INSERT INTO application_users(id,auth_provider,auth_subject,default_business_id) VALUES ($1,$2,$3,$4)", [user.id,provider,role,business]);
      await client.query("INSERT INTO memberships(id,business_id,user_id,role,status) VALUES ($1,$2,$3,$4,'ACTIVE')", [user.member,business,user.id,role === "FOREIGN" ? "OWNER" : role]);
    }
    await client.query("INSERT INTO fields(id,business_id,name,representative_point) VALUES ($1,$2,'test',ST_SetSRID(ST_MakePoint(29,41),4326))", [fieldId,businessId]);
    if (options.validated) {
      await client.query("INSERT INTO crop_definition_versions(id,crop_key,version,display_name) VALUES ($1,$2,'1','test')", [cropId,provider]);
      await client.query("INSERT INTO validated_template_versions(id,template_key,version,crop_definition_version_id,task_definitions) VALUES ($1,$2,'1',$3,'[]')", [templateId,provider,cropId]);
      await client.query("INSERT INTO seasons(id,business_id,field_id,crop_key,crop_definition_version_id,actual_planting_date) VALUES ($1,$2,$3,$4,$5,'2024-01-01')", [seasonId,businessId,fieldId,provider,cropId]);
      await client.query("INSERT INTO season_plans(id,season_id,source,template_version_id,source_snapshot,status) VALUES ($1,$2,'VALIDATED_TEMPLATE',$3,'{}','APPROVED')", [planId,seasonId,templateId]);
      await client.query("INSERT INTO planned_tasks(id,season_plan_id,title,planned_local_date) VALUES ($1,$2,'legacy null key','2024-01-01')", [legacyTaskId,planId]);
    } else {
      await client.query("INSERT INTO custom_crops(id,business_id,display_name) VALUES ($1,$2,'test')", [cropId,businessId]);
      await client.query("INSERT INTO seasons(id,business_id,field_id,custom_crop_id,actual_planting_date) VALUES ($1,$2,$3,$4,'2024-01-01')", [seasonId,businessId,fieldId,cropId]);
      await client.query("INSERT INTO season_plans(id,season_id,source,source_snapshot,status) VALUES ($1,$2,'MANUAL','{}','APPROVED')", [planId,seasonId]);
    }
    await client.query("UPDATE seasons SET status='ACTIVE',activated_at=now() WHERE id=$1", [seasonId]);
    await client.query("INSERT INTO season_context_snapshots(season_id,crop_snapshot,source,template_version_id,activated_at,business_timezone,activated_local_date) SELECT s.id,'{\"approvedTasks\":[]}'::jsonb,p.source,p.template_version_id,s.activated_at,'Europe/Istanbul',(s.activated_at AT TIME ZONE 'Europe/Istanbul')::date FROM seasons s JOIN season_plans p ON p.season_id=s.id WHERE s.id=$1", [seasonId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  return { prisma, pool, businessId, foreignBusinessId, fieldId, seasonId, planId, templateId, legacyTaskId, users,
    async close() { await prisma.$disconnect(); await pool.end(); } };
}
