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
 * Operações sobre a tabela despejos. Toda leitura, alteração e remoção filtra por usuario_id
 * (dono da conta), para que ninguém veja nem altere despejos de outra pessoa.
 */
export function criarRepositorio(pool) {
  return {
    async verificar() {
      await pool.query("select 1");
    },

    /** Salva um despejo na conta do usuário. */
    async salvar({ usuarioId, dispositivoId, texto, resultado }) {
      const { rows } = await pool.query(
        `insert into despejos (usuario_id, dispositivo_id, texto, resultado)
         values ($1, $2, $3, $4::jsonb)
         returning id, criado_em`,
        [usuarioId, dispositivoId, texto, JSON.stringify(resultado)]
      );
      return { id: rows[0].id, data: new Date(rows[0].criado_em).toISOString() };
    },

    async listar(usuarioId, limite = LIMITE_LISTA_PADRAO) {
      const { rows } = await pool.query(
        `select id, criado_em, texto, resultado, progresso
           from despejos
          where usuario_id = $1
            and criado_em > now() - make_interval(days => $2)
          order by criado_em desc
          limit $3`,
        [usuarioId, DIAS_RETENCAO, limite]
      );
      return rows.map(paraEntrada);
    },

    /** Substitui o progresso (checklist e micro-passos) de um despejo. Devolve true se encontrou o despejo. */
    async atualizarProgresso(usuarioId, id, progresso) {
      const { rowCount } = await pool.query(
        "update despejos set progresso = $3::jsonb where id = $1 and usuario_id = $2",
        [id, usuarioId, JSON.stringify(progresso)]
      );
      return rowCount > 0;
    },

    /** Devolve true se apagou algo. */
    async apagar(usuarioId, id) {
      const { rowCount } = await pool.query("delete from despejos where id = $1 and usuario_id = $2", [id, usuarioId]);
      return rowCount > 0;
    },

    /** Devolve quantos despejos foram apagados. */
    async apagarTodos(usuarioId) {
      const { rowCount } = await pool.query("delete from despejos where usuario_id = $1", [usuarioId]);
      return rowCount;
    },

    /**
     * Leva para a conta os despejos que este navegador guardou na nuvem antes do login
     * (período sem login). Só pega os que ainda não têm dono. Devolve quantos foram vinculados.
     */
    async vincularDispositivo(usuarioId, dispositivoId) {
      const { rowCount } = await pool.query(
        "update despejos set usuario_id = $1 where dispositivo_id = $2 and usuario_id is null",
        [usuarioId, dispositivoId]
      );
      return rowCount;
    },

    /**
     * Importa despejos que estavam só no navegador. Um id que já existe (inclusive de outra conta)
     * é ignorado, nunca sobrescrito. Devolve quantos foram importados.
     * @param {{ id: string, data: string, texto: string, resultado: object, progresso: object }[]} despejos já validados
     */
    async importar(usuarioId, dispositivoId, despejos) {
      let importados = 0;
      for (const despejo of despejos) {
        const { rowCount } = await pool.query(
          `insert into despejos (id, usuario_id, dispositivo_id, criado_em, texto, resultado, progresso)
           values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
           on conflict (id) do nothing`,
          [
            despejo.id,
            usuarioId,
            dispositivoId,
            despejo.data,
            despejo.texto,
            JSON.stringify(despejo.resultado),
            JSON.stringify(despejo.progresso),
          ]
        );
        importados += rowCount;
      }
      return importados;
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
