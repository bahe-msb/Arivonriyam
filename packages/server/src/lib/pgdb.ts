import pg from "pg";

const dsn = process.env.PG_DSN ?? "postgresql://localhost/arivonriyam_rag";

let _pool: pg.Pool | null = null;

export function getPgPool(): pg.Pool {
  if (!_pool) {
    _pool = new pg.Pool({ connectionString: dsn });
  }
  return _pool;
}
