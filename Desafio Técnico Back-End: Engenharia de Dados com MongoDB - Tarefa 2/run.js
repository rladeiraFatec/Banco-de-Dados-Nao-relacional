const { MongoClient } = require('mongodb');
const { performance } = require('node:perf_hooks');

const {
  STATUS_VALIDOS,
  JANELA_DIAS,
  corteUltimosDias,
  pipelineFaturamento,
  pipelineRankingVip
} = require('./pipelines');

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27018/?replicaSet=rs0';
const DB_NAME = process.env.DB_NAME || 'marketplace_tarefa1';
const PAGINA = Number(process.env.PAGINA) || 1;
const TAMANHO_PAGINA = Number(process.env.TAMANHO_PAGINA) || 10;
const REPETICOES = 3;

const brl = (valor) =>
  valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function estagiosDoPlano(explain) {
  return (explain.stages || []).map((estagio) => Object.keys(estagio)[0]).join(' > ');
}

function statsDoCursor(explain) {
  const cursor = (explain.stages || []).find((estagio) => estagio.$cursor)?.$cursor;
  return cursor?.executionStats || {};
}

function resumirExplain(explain) {
  const stats = statsDoCursor(explain);
  const indices = new Set();

  function visitar(no) {
    if (!no) return;
    if (no.indexName) indices.add(no.indexName);
    if (no.inputStage) visitar(no.inputStage);
    if (Array.isArray(no.inputStages)) no.inputStages.forEach(visitar);
    if (no.queryPlan) visitar(no.queryPlan);
  }

  const cursor = (explain.stages || []).find((estagio) => estagio.$cursor)?.$cursor;
  visitar(cursor?.queryPlanner?.winningPlan);

  return {
    estagios: estagiosDoPlano(explain),
    indice: [...indices].join(', ') || '-',
    docsExaminados: stats.totalDocsExamined ?? 0,
    chavesExaminadas: stats.totalKeysExamined ?? 0,
    retornados: stats.nReturned ?? 0
  };
}

async function medirTempo(executar, repeticoes = REPETICOES) {
  await executar();
  const tempos = [];

  for (let i = 0; i < repeticoes; i++) {
    const inicio = performance.now();
    await executar();
    tempos.push(performance.now() - inicio);
  }

  return {
    melhorMs: Number(Math.min(...tempos).toFixed(2)),
    mediaMs: Number((tempos.reduce((a, b) => a + b, 0) / tempos.length).toFixed(2))
  };
}

async function main() {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    console.log(`Conectado ao MongoDB em ${URI}`);
    console.log(`Banco: ${DB_NAME}`);
    console.log(`Status considerados: ${STATUS_VALIDOS.join(', ')}`);
    console.log(`Janela: últimos ${JANELA_DIAS} dias`);

    const db = client.db(DB_NAME);
    const orders = db.collection('orders');
    const users = db.collection('users');

    const totalPedidos = await orders.countDocuments();
    const totalUsuarios = await users.countDocuments();
    if (totalPedidos === 0 || totalUsuarios === 0) {
      throw new Error('Banco sem dados. Execute o setup da Tarefa 1 antes.');
    }

    const corte = corteUltimosDias();
    console.log(`Corte de data: ${corte.toISOString()}`);
    console.log(`Pedidos: ${totalPedidos} | Usuários: ${totalUsuarios}`);

    const pedidosValidos = await orders.countDocuments({
      status: { $in: STATUS_VALIDOS },
      createdAt: { $gte: corte }
    });
    console.log(`Pedidos válidos nos últimos ${JANELA_DIAS} dias: ${pedidosValidos}`);

    // ---------------------------------------------------------------
    // Pipeline 1 — faturamento por categoria
    // ---------------------------------------------------------------
    const pipeFaturamento = pipelineFaturamento(corte);
    const faturamento = await orders.aggregate(pipeFaturamento).toArray();

    const explainFaturamento = await db.command({
      explain: { aggregate: 'orders', pipeline: pipeFaturamento, cursor: {} },
      verbosity: 'executionStats'
    });

    const tempoFaturamento = await medirTempo(() =>
      orders.aggregate(pipeFaturamento).toArray()
    );

    const [conferenciaFaturamento] = await orders
      .aggregate([
        {
          $match: {
            status: { $in: STATUS_VALIDOS },
            createdAt: { $gte: corte }
          }
        },
        { $unwind: '$items' },
        {
          $group: {
            _id: null,
            faturamentoTotal: {
              $sum: { $multiply: ['$items.unitPrice', '$items.quantity'] }
            },
            itensVendidos: { $sum: '$items.quantity' }
          }
        }
      ])
      .toArray();

    const somaCategorias = Number(
      faturamento.reduce((total, linha) => total + linha.faturamentoTotal, 0).toFixed(2)
    );
    const itensCategorias = faturamento.reduce(
      (total, linha) => total + linha.itensVendidos,
      0
    );

    console.log('\n=== Faturamento por categoria (últimos 90 dias) ===');
    console.table(
      faturamento.map((linha) => ({
        categoria: linha.categoria,
        faturamento: brl(linha.faturamentoTotal),
        faturamentoNumerico: linha.faturamentoTotal,
        itensVendidos: linha.itensVendidos
      }))
    );

    console.log('Conferência do pipeline 1:');
    console.table([
      {
        somaDasCategorias: somaCategorias,
        totalConferido: Number(conferenciaFaturamento.faturamentoTotal.toFixed(2)),
        itensDasCategorias: itensCategorias,
        itensConferidos: conferenciaFaturamento.itensVendidos,
        consistente:
          somaCategorias === Number(conferenciaFaturamento.faturamentoTotal.toFixed(2)) &&
          itensCategorias === conferenciaFaturamento.itensVendidos
      }
    ]);

    console.log('Plano do pipeline 1:');
    console.table([{ ...resumirExplain(explainFaturamento), ...tempoFaturamento }]);

    // ---------------------------------------------------------------
    // Pipeline 2 — ranking VIP paginado
    // ---------------------------------------------------------------
    const pipeRanking = pipelineRankingVip({
      pagina: PAGINA,
      tamanhoPagina: TAMANHO_PAGINA
    });
    const [ranking] = await users.aggregate(pipeRanking).toArray();

    const explainRanking = await db.command({
      explain: { aggregate: 'users', pipeline: pipeRanking, cursor: {} },
      verbosity: 'executionStats'
    });

    const tempoRanking = await medirTempo(() => users.aggregate(pipeRanking).toArray());

    const [conferenciaVip] = await users
      .aggregate([
        { $match: { city: 'São Paulo' } },
        {
          $lookup: {
            from: 'orders',
            localField: '_id',
            foreignField: 'userId',
            pipeline: [
              { $match: { status: { $in: STATUS_VALIDOS } } },
              { $project: { _id: 1 } }
            ],
            as: 'pedidos'
          }
        },
        { $match: { 'pedidos.0': { $exists: true } } },
        { $count: 'clientesElegiveis' }
      ])
      .toArray();

    const totalFacet = ranking.total[0]?.clientesElegiveis ?? 0;

    console.log(`\n=== Ranking VIP de São Paulo — página ${PAGINA} ===`);
    console.table(
      ranking.dados.map((cliente, indice) => ({
        posicao: (PAGINA - 1) * TAMANHO_PAGINA + indice + 1,
        nome: cliente.nome,
        email: cliente.email,
        totalGasto: brl(cliente.totalGasto),
        totalNumerico: cliente.totalGasto,
        quantidadePedidos: cliente.quantidadePedidos
      }))
    );

    console.log('Resultado do $facet:');
    console.table([
      {
        clientesElegiveisFacet: totalFacet,
        clientesElegiveisConferidos: conferenciaVip?.clientesElegiveis ?? 0,
        consistente: totalFacet === (conferenciaVip?.clientesElegiveis ?? 0),
        pagina: PAGINA,
        tamanhoPagina: TAMANHO_PAGINA,
        itensNaPagina: ranking.dados.length
      }
    ]);

    console.log('Plano do pipeline 2:');
    console.table([{ ...resumirExplain(explainRanking), ...tempoRanking }]);

    console.log('\nBenchmark concluído.');
  } catch (err) {
    console.error('Erro ao executar os pipelines:', err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, URI, DB_NAME };
