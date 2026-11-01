// Cria (ou atualiza) as tabelas do banco a partir de db/schema.sql.
// Uso: npm run db:setup   — requer DATABASE_URL no .env. Pode rodar mais de uma vez.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { criarPool } from "../lib/db.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[ERRO] DATABASE_URL não encontrada no .env.");
  process.exit(1);
}

const caminhoCa =
  process.env.DATABASE_CA_PATH || fileURLToPath(new URL("../certs/supabase-ca.crt", import.meta.url));
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

let pool;
try {
  pool = criarPool({ url, caminhoCa });
  await pool.query(schema);

  const { rows } = await pool.query("select relrowsecurity from pg_class where oid = to_regclass('public.despejos')");
  if (rows.length === 0) throw new Error("a tabela despejos não foi encontrada depois de aplicar o schema");

  console.log("Banco configurado: tabela despejos pronta.");
  console.log(`RLS (bloqueio da API pública do Supabase): ${rows[0].relrowsecurity ? "ligado" : "DESLIGADO"}`);
} catch (erro) {
  // Mostra só código e mensagem: a string de conexão nunca é impressa.
  console.error("[ERRO] Não foi possível configurar o banco:", erro.code ?? "", erro.message);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
