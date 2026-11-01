// Testes do repositório do banco (lib/db.js), com um pool falso que registra as consultas.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { criarRepositorio, ehUuid, DIAS_RETENCAO } from "../lib/db.js";

const DISPOSITIVO = "11111111-1111-4111-8111-111111111111";
const DESPEJO = "22222222-2222-4222-8222-222222222222";
const USUARIO = "33333333-3333-4333-8333-333333333333";

/** Pool falso: devolve as respostas da fila em ordem e guarda { sql, params } de cada consulta. */
function criarPoolFalso(respostas = []) {
  const consultas = [];
  return {
    consultas,
    async query(sql, params) {
      consultas.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      return respostas.shift() ?? { rows: [], rowCount: 0 };
    },
  };
}

describe("ehUuid", () => {
  it("aceita UUIDs e recusa o resto", () => {
    assert.equal(ehUuid(DISPOSITIVO), true);
    assert.equal(ehUuid(DISPOSITIVO.toUpperCase()), true);
    for (const invalido of ["", "abc", "1234", null, undefined, 42, `${DISPOSITIVO}x`, "' or 1=1 --"]) {
      assert.equal(ehUuid(invalido), false, String(invalido));
    }
  });
});

describe("criarRepositorio", () => {
  it("salvar insere com parâmetros (sem concatenar texto no SQL) e devolve id e data", async () => {
    const criadoEm = new Date("2026-11-01T12:00:00Z");
    const pool = criarPoolFalso([{ rows: [{ id: DESPEJO, criado_em: criadoEm }], rowCount: 1 }]);
    const repo = criarRepositorio(pool);
    const resultado = { tarefas: ["Pagar luz"] };
    const textoMalicioso = "'); drop table despejos; --";

    const salvo = await repo.salvar({ usuarioId: USUARIO, dispositivoId: DISPOSITIVO, texto: textoMalicioso, resultado });

    assert.deepEqual(salvo, { id: DESPEJO, data: criadoEm.toISOString() });
    const [{ sql, params }] = pool.consultas;
    assert.match(sql, /^insert into despejos/);
    assert.doesNotMatch(sql, /drop table/, "o texto do usuário nunca entra no SQL");
    assert.deepEqual(params, [USUARIO, DISPOSITIVO, textoMalicioso, JSON.stringify(resultado)]);
  });

  it("listar filtra pelo usuário, respeita a retenção e o limite", async () => {
    const pool = criarPoolFalso([
      {
        rows: [{ id: DESPEJO, criado_em: new Date("2026-11-01T12:00:00Z"), texto: "oi", resultado: { tarefas: [] } }],
        rowCount: 1,
      },
    ]);
    const lista = await criarRepositorio(pool).listar(USUARIO, 5);

    assert.deepEqual(lista, [
      { id: DESPEJO, data: "2026-11-01T12:00:00.000Z", texto: "oi", resultado: { tarefas: [] }, progresso: {} },
    ]);
    const [{ sql, params }] = pool.consultas;
    assert.match(sql, /where usuario_id = \$1/);
    assert.match(sql, /order by criado_em desc/);
    assert.deepEqual(params, [USUARIO, DIAS_RETENCAO, 5]);
  });

  it("apagar só remove despejos do próprio usuário", async () => {
    const pool = criarPoolFalso([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 0 }]);
    const repo = criarRepositorio(pool);

    assert.equal(await repo.apagar(USUARIO, DESPEJO), true);
    assert.equal(await repo.apagar(USUARIO, DESPEJO), false);

    const { sql, params } = pool.consultas[0];
    assert.match(sql, /where id = \$1 and usuario_id = \$2/);
    assert.deepEqual(params, [DESPEJO, USUARIO]);
  });

  it("atualizarProgresso só altera despejos do próprio usuário", async () => {
    const pool = criarPoolFalso([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 0 }]);
    const repo = criarRepositorio(pool);
    const progresso = { concluidas: [0], micro_passos: {} };

    assert.equal(await repo.atualizarProgresso(USUARIO, DESPEJO, progresso), true);
    assert.equal(await repo.atualizarProgresso(USUARIO, DESPEJO, progresso), false);

    const { sql, params } = pool.consultas[0];
    assert.match(sql, /^update despejos set progresso = \$3::jsonb where id = \$1 and usuario_id = \$2$/);
    assert.deepEqual(params, [DESPEJO, USUARIO, JSON.stringify(progresso)]);
  });

  it("apagarTodos filtra pelo usuário", async () => {
    const pool = criarPoolFalso([{ rows: [], rowCount: 3 }]);
    assert.equal(await criarRepositorio(pool).apagarTodos(USUARIO), 3);
    assert.match(pool.consultas[0].sql, /where usuario_id = \$1$/);
    assert.deepEqual(pool.consultas[0].params, [USUARIO]);
  });

  it("vincularDispositivo só pega despejos do dispositivo que ainda não têm dono", async () => {
    const pool = criarPoolFalso([{ rows: [], rowCount: 2 }]);
    assert.equal(await criarRepositorio(pool).vincularDispositivo(USUARIO, DISPOSITIVO), 2);
    const [{ sql, params }] = pool.consultas;
    assert.match(sql, /^update despejos set usuario_id = \$1 where dispositivo_id = \$2 and usuario_id is null$/);
    assert.deepEqual(params, [USUARIO, DISPOSITIVO]);
  });

  it("importar nunca sobrescreve um id existente e conta só o que entrou", async () => {
    const pool = criarPoolFalso([{ rows: [], rowCount: 1 }, { rows: [], rowCount: 0 }]);
    const despejo = (id) => ({
      id,
      data: "2026-10-30T10:00:00.000Z",
      texto: "oi",
      resultado: { tarefas: [] },
      progresso: { concluidas: [] },
    });
    const outro = "44444444-4444-4444-8444-444444444444";

    const importados = await criarRepositorio(pool).importar(USUARIO, DISPOSITIVO, [despejo(DESPEJO), despejo(outro)]);

    assert.equal(importados, 1);
    assert.equal(pool.consultas.length, 2);
    assert.match(pool.consultas[0].sql, /on conflict \(id\) do nothing$/);
    assert.deepEqual(pool.consultas[0].params, [
      DESPEJO,
      USUARIO,
      DISPOSITIVO,
      "2026-10-30T10:00:00.000Z",
      "oi",
      JSON.stringify({ tarefas: [] }),
      JSON.stringify({ concluidas: [] }),
    ]);
  });

  it("limparAntigos usa o prazo de retenção", async () => {
    const pool = criarPoolFalso([{ rows: [], rowCount: 2 }]);
    assert.equal(await criarRepositorio(pool).limparAntigos(), 2);
    assert.match(pool.consultas[0].sql, /criado_em < now\(\) - make_interval\(days => \$1\)/);
    assert.deepEqual(pool.consultas[0].params, [DIAS_RETENCAO]);
  });
});
