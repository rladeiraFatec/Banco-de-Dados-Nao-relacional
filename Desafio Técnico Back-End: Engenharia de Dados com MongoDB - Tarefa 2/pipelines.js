const STATUS_VALIDOS = ['PAID', 'SHIPPED', 'DELIVERED'];
const JANELA_DIAS = 90;

function corteUltimosDias(dias = JANELA_DIAS) {
  return new Date(Date.now() - dias * 86400000);
}

/**
 * Faturamento e itens vendidos por categoria.
 * O filtro acontece antes do $unwind para reduzir o volume que entra no pipeline.
 */
function pipelineFaturamento(corte = corteUltimosDias()) {
  return [
    {
      $match: {
        status: { $in: STATUS_VALIDOS },
        createdAt: { $gte: corte }
      }
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.category',
        faturamentoTotal: {
          $sum: { $multiply: ['$items.unitPrice', '$items.quantity'] }
        },
        itensVendidos: { $sum: '$items.quantity' }
      }
    },
    {
      $project: {
        _id: 0,
        categoria: '$_id',
        faturamentoTotal: { $round: ['$faturamentoTotal', 2] },
        itensVendidos: 1
      }
    },
    { $sort: { faturamentoTotal: -1 } }
  ];
}

/**
 * Ranking dos clientes de São Paulo por total gasto, com página e total
 * de clientes elegíveis devolvidos pelo mesmo $facet.
 */
function pipelineRankingVip({ pagina = 1, tamanhoPagina = 10 } = {}) {
  const paginaSegura = Math.max(1, Number(pagina) || 1);
  const tamanhoSeguro = Math.max(1, Number(tamanhoPagina) || 10);
  const skip = (paginaSegura - 1) * tamanhoSeguro;

  return [
    { $match: { city: 'São Paulo' } },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'userId',
        pipeline: [
          { $match: { status: { $in: STATUS_VALIDOS } } },
          { $project: { totalAmount: 1 } }
        ],
        as: 'pedidos'
      }
    },
    { $unwind: '$pedidos' },
    {
      $group: {
        _id: '$_id',
        nome: { $first: '$name' },
        email: { $first: '$email' },
        totalGasto: { $sum: '$pedidos.totalAmount' },
        quantidadePedidos: { $sum: 1 }
      }
    },
    {
      $facet: {
        dados: [
          { $sort: { totalGasto: -1, _id: 1 } },
          { $skip: skip },
          { $limit: tamanhoSeguro },
          {
            $project: {
              _id: 0,
              nome: 1,
              email: 1,
              quantidadePedidos: 1,
              totalGasto: { $round: ['$totalGasto', 2] }
            }
          }
        ],
        total: [{ $count: 'clientesElegiveis' }]
      }
    }
  ];
}

module.exports = {
  STATUS_VALIDOS,
  JANELA_DIAS,
  corteUltimosDias,
  pipelineFaturamento,
  pipelineRankingVip
};
