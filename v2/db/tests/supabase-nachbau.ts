/**
 * Nachbau von Supabase für Tests: echter PostgreSQL 16 + PostgREST + JWT, davor ein Mini-Proxy für /rest/v1.
 * Die Migration wird genau so eingespielt wie im Supabase-SQL-Editor (Rolle postgres, Supabase-Standardrechte).
 * Läuft nur, wenn PostgreSQL (PG_BIN) und PostgREST (POSTGREST_BIN) vorhanden sind.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import http from "node:http";

export const PG_BIN = process.env.PG_BIN ?? "/usr/lib/postgresql/16/bin";
export const POSTGREST_BIN = process.env.POSTGREST_BIN ?? "";
export const verfuegbar = () => existsSync(`${PG_BIN}/postgres`) && !!POSTGREST_BIN && existsSync(POSTGREST_BIN);

const DIR = "/tmp/haushalt-pgtest";
const PG_PORT = 54329, REST_PORT = 54330, PROXY_PORT = 54331;
const SECRET = "test-secret-nur-fuer-den-nachbau-mindestens-32-zeichen";
let rest: ChildProcess | null = null;
let proxy: http.Server | null = null;

const alsPostgres = (cmd: string, args: string[]) =>
  execFileSync("runuser", ["-u", "postgres", "--", cmd, ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const psql = (db: string, sql: string) => alsPostgres(`${PG_BIN}/psql`, ["-h", DIR, "-p", String(PG_PORT), "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql]);
const psqlDatei = (db: string, datei: string) => alsPostgres(`${PG_BIN}/psql`, ["-h", DIR, "-p", String(PG_PORT), "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-f", datei]);

export function jwt(sub: string | null, role = "authenticated"): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ ...(sub ? { sub } : {}), role, aud: role, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}
export const URL_SUPABASE = `http://localhost:${PROXY_PORT}`;

export async function starten(migrationsDatei: string) {
  stoppen();
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  execFileSync("chown", ["postgres:postgres", DIR]);
  alsPostgres(`${PG_BIN}/initdb`, ["-D", `${DIR}/data`, "-A", "trust", "-U", "postgres", "--no-sync", "-E", "UTF8", "--locale=C.UTF-8"]);
  alsPostgres(`${PG_BIN}/pg_ctl`, ["-D", `${DIR}/data`, "-o", `-p ${PG_PORT} -k ${DIR} -c listen_addresses=localhost -c fsync=off`, "-l", `${DIR}/log`, "-w", "start"]);
  psql("postgres", "create database haushalt");
  // Supabase-Grundausstattung: Rollen, auth.uid(), Standardrechte im Schema public
  psql("haushalt", `
    create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls;
    create role authenticator login password 'geheim' noinherit; grant anon, authenticated, service_role to authenticator;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`);
  chmodSync(migrationsDatei, 0o644);
  const kopie = `${DIR}/migration.sql`;
  execFileSync("cp", [migrationsDatei, kopie]);
  execFileSync("chown", ["postgres:postgres", kopie]);
  psqlDatei("haushalt", kopie);

  writeFileSync(`${DIR}/postgrest.conf`, [
    `db-uri = "postgres://authenticator:geheim@localhost:${PG_PORT}/haushalt"`, `db-schemas = "public"`, `db-anon-role = "anon"`,
    `jwt-secret = "${SECRET}"`, `server-port = ${REST_PORT}`, `db-pool = 4`, `log-level = "warn"`].join("\n"));
  rest = spawn(POSTGREST_BIN, [`${DIR}/postgrest.conf`], { stdio: "ignore" });
  proxy = http.createServer((req, res) => {
    const pfad = (req.url ?? "").replace(/^\/rest\/v1/, "");
    const p = http.request({ host: "localhost", port: REST_PORT, path: pfad, method: req.method, headers: { ...req.headers, host: `localhost:${REST_PORT}` } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res);
    });
    p.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(p);
  }).listen(PROXY_PORT);
  for (let i = 0; i < 100; i++) {
    const ok = await fetch(`http://localhost:${REST_PORT}/`).then((r) => r.ok).catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("PostgREST startet nicht");
}

export function sql(q: string) { return psql("haushalt", q); }

export function stoppen() {
  rest?.kill(); rest = null;
  proxy?.close(); proxy = null;
  if (existsSync(`${DIR}/data/postmaster.pid`)) { try { alsPostgres(`${PG_BIN}/pg_ctl`, ["-D", `${DIR}/data`, "-m", "fast", "-w", "stop"]); } catch { /* schon gestoppt */ } }
}
