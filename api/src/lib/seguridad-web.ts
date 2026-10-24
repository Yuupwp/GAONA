import type { PrismaClient } from "@prisma/client";

export async function auditarIdentidadWeb(db: PrismaClient, env: NodeJS.ProcessEnv): Promise<boolean> {
  const url = new URL(env.WEB_DATABASE_URL!);
  const esperado = decodeURIComponent(url.username).split(".")[0];
  const [r] = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return tx.$queryRaw<{ identidad: string; sesion: string; base: string; puerto: string; loopback: boolean; seguro: boolean }[]>`
      SELECT current_user AS identidad, session_user AS sesion, current_database() AS base,
        current_setting('port') AS puerto, host(inet_server_addr())='127.0.0.1' AS loopback,
        EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolcanlogin
          AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
        AND NOT EXISTS(SELECT 1 FROM pg_roles p WHERE pg_has_role(current_user,p.oid,'MEMBER') AND
          (p.rolsuper OR p.rolbypassrls OR p.rolcreatedb OR p.rolcreaterole OR p.rolreplication
            OR p.rolname IN ('pg_read_all_data','pg_write_all_data','pg_execute_server_program','pg_read_server_files','pg_write_server_files')))
        AND NOT has_schema_privilege(current_user,'public','CREATE')
        AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
          AND c.relname NOT IN ('productos','categorias','clientes','solicitudes','solicitud_detalles')
          AND (has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
            OR has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER')))
        AND (SELECT count(*)=5 AND bool_and(c.relrowsecurity AND NOT pg_has_role(current_user,c.relowner,'MEMBER'))
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
          AND c.relkind='r' AND c.relname IN ('productos','categorias','clientes','solicitudes','solicitud_detalles')) AS seguro`;
  }, { timeout: 15000 });
  if (!r?.seguro || r.identidad !== esperado || r.sesion !== esperado || r.base !== decodeURIComponent(url.pathname.slice(1)) ||
    (env.WEB_DATABASE_ROLE && r.identidad !== env.WEB_DATABASE_ROLE)) throw new Error("WEB10_IDENTIDAD: Conexión pública rechazada");
  const perfiles: Record<string, string> = { gaona_persistencia_aislada: "gaona_web_pruebas", gaona_web3_aislada: "gaona_web_publico_pruebas" };
  return env.NODE_ENV === "development" && env.GAONA_WEB10_LOCAL === "POSTGRES_AISLADO" &&
    url.hostname === "127.0.0.1" && Boolean(url.port) && url.port !== "5432" && r.puerto === url.port && r.loopback === true &&
    perfiles[r.base] === r.identidad;
}
