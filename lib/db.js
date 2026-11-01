// Acesso ao banco (Postgres / Supabase). É opcional: sem DATABASE_URL, o app funciona só com o LocalStorage.
// O repositório recebe o pool por parâmetro, o que permite testar sem um banco de verdade.
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

/** Despejos mais antigos que isso são apagados automaticamente (ambiente de teste). */
export const DIAS_RETENCAO = 30;
export const LIMITE_LISTA_PADRAO = 5;
export const LIMITE_LISTA_MAXIMO = 50;

const PADRAO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(valor) {
  return typeof valor === "string" && PADRAO_UUID.test(valor);
}

/**
 * Cria o pool de conexões com TLS e verificação de certificado sempre ligada.
 * Se `caminhoCa` existir (ex.: certificado raiz do Supabase), confia nele;
 * caso contrário, usa as autoridades certificadoras do sistema.
 */
export function criarPool({ url, caminhoCa }) {
  const endereco = new URL(url);
  // Um sslmode na URL sobrescreveria a configuração TLS abaixo.
  endereco.searchParams.delete("sslmode");

  const temCa = Boolean(caminhoCa) && existsSync(caminhoCa);
  const pool = new pg.Pool({
    connectionString: endereco.toString(),
    ssl: temCa ? { ca: readFileSync(caminhoCa, "utf8") } : true,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // Sem este handler, uma conexão ociosa que cai derruba o processo inteiro.
  pool.on("error", (erro) => console.error("[Banco] Erro numa conexão ociosa:", erro.message));
  return pool;
}

/** Converte uma linha do banco no formato de entrada de histórico usado pelo frontend. */
function paraEntrada(linha) {
  return {
    id: linha.id,
    data: new Date(linha.criado_em).toISOString(),
    texto: linha.texto,
    resultado: linha.resultado,
    progresso: linha.progresso ?? {},
  };
}

/**
 * Operações sobre a tabela despejos. Toda leitura e remoção filtra por dispositivo_id,
 * para que um navegador nunca veja nem apague despejos de outro.
 */
export function criarRepositorio(pool) {
  return {
    async verificar() {
      await pool.query("select 1");
    },

    async salvar({ dispositivoId, texto, resultado }) {
      const { rows } = await pool.query(
        `insert into despejos (dispositivo_id, texto, resultado)
         values ($1, $2, $3::jsonb)
         returning id, criado_em`,
        [dispositivoId, texto, JSON.stringify(resultado)]
      );
      return { id: rows[0].id, data: new Date(rows[0].criado_em).toISOString() };
    },

    async listar(dispositivoId, limite = LIMITE_LISTA_PADRAO) {
      const { rows } = await pool.query(
        `select id, criado_em, texto, resultado, progresso
           from despejos
          where dispositivo_id = $1
            and criado_em > now() - make_interval(days => $2)
          order by criado_em desc
          limit $3`,
        [dispositivoId, DIAS_RETENCAO, limite]
      );
      return rows.map(paraEntrada);
    },

    /** Substitui o progresso (checklist e micro-passos) de um despejo. Devolve true se encontrou o despejo. */
    async atualizarProgresso(dispositivoId, id, progresso) {
      const { rowCount } = await pool.query(
        "update despejos set progresso = $3::jsonb where id = $1 and dispositivo_id = $2",
        [id, dispositivoId, JSON.stringify(progresso)]
      );
      return rowCount > 0;
    },

    /** Devolve true se apagou algo. */
    async apagar(dispositivoId, id) {
      const { rowCount } = await pool.query("delete from despejos where id = $1 and dispositivo_id = $2", [
        id,
        dispositivoId,
      ]);
      return rowCount > 0;
    },

    /** Devolve quantos despejos foram apagados. */
    async apagarTodos(dispositivoId) {
      const { rowCount } = await pool.query("delete from despejos where dispositivo_id = $1", [dispositivoId]);
      return rowCount;
    },

    /** Apaga os despejos mais antigos que o prazo de retenção. Devolve quantos foram apagados. */
    async limparAntigos(dias = DIAS_RETENCAO) {
      const { rowCount } = await pool.query("delete from despejos where criado_em < now() - make_interval(days => $1)", [
        dias,
      ]);
      return rowCount;
    },
  };
}

/** Roda a limpeza agora e depois periodicamente (padrão: a cada 6 horas). */
export function iniciarLimpezaPeriodica(repositorio, { intervaloMs = 6 * 60 * 60 * 1000 } = {}) {
  const limpar = async () => {
    try {
      const apagados = await repositorio.limparAntigos();
      if (apagados > 0) console.log(`[Banco] ${apagados} despejo(s) com mais de ${DIAS_RETENCAO} dias apagado(s).`);
    } catch (erro) {
      console.error("[Banco] Falha na limpeza de despejos antigos:", erro.message);
    }
  };
  limpar();
  const timer = setInterval(limpar, intervaloMs);
  timer.unref(); // não impede o processo de encerrar
  return timer;
}
