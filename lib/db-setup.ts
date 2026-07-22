import { sql } from "drizzle-orm";

import { getDb, isDbConfigured } from "@/db";

export async function ensureDatabaseTables() {
  if (!isDbConfigured()) {
    throw new Error("DATABASE_URL is not configured");
  }

  const db = getDb();

  await db.execute(sql`
    create table if not exists sources (
      id integer generated always as identity primary key,
      name varchar(80) not null unique,
      kind varchar(40) not null,
      created_at timestamptz not null default now()
    );
  `);

  await db.execute(sql`
    create table if not exists keywords (
      id integer generated always as identity primary key,
      term varchar(160) not null unique,
      category varchar(80) not null,
      source_id integer references sources(id),
      created_at timestamptz not null default now()
    );
  `);

  await db.execute(sql`
    create table if not exists trend_snapshots (
      id integer generated always as identity primary key,
      keyword_id integer not null references keywords(id),
      score integer,
      growth_rate varchar(32),
      velocity varchar(32),
      summary text,
      reason text,
      source_label varchar(200),
      external_ref varchar(120),
      source_url varchar(500),
      captured_at timestamptz not null default now()
    );
  `);

  await db.execute(sql`
    create table if not exists trend_contents (
      id integer generated always as identity primary key,
      keyword_id integer not null references keywords(id),
      kind varchar(32) not null,
      title text not null,
      url varchar(500) not null,
      source varchar(160),
      rank integer,
      published_at timestamptz,
      created_at timestamptz not null default now()
    );
  `);

  await db.execute(sql`alter table trend_contents add column if not exists kind varchar(32) not null default 'unknown';`);
  await db.execute(sql`alter table trend_contents add column if not exists title text not null default '';`);
  await db.execute(sql`alter table trend_contents add column if not exists url varchar(500) not null default '';`);
  await db.execute(sql`alter table trend_contents add column if not exists source varchar(160);`);
  await db.execute(sql`alter table trend_contents add column if not exists rank integer;`);
  await db.execute(sql`alter table trend_contents add column if not exists published_at timestamptz;`);
  await db.execute(sql`alter table trend_contents add column if not exists created_at timestamptz not null default now();`);

  await db.execute(sql`
    alter table trend_snapshots
    add column if not exists external_ref varchar(120);
  `);

  await db.execute(sql`
    alter table trend_snapshots
    add column if not exists source_url varchar(500);
  `);

  return { ok: true };
}
