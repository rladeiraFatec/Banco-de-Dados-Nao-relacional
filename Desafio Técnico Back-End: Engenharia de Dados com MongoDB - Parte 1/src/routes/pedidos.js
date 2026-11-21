import { Router } from 'express';
import { db, proximoId } from '../store.js';
import { arredondarDinheiro, corpoObjeto, id, inteiro, umDe } from '../validacao.js';
import { HttpError } from '../errors.js';
import { buscarProduto, exigirProduto, exigirUsuario, pedidoPublico } from '../dominio.js';

const router = Router();
const STATUS = ['confirmado', 'cancelado'];

// RF08 - Realizar compra (apenas comprador)
router.post('/', (req, res) => {
  const corpo = corpoObjeto(req.body ?? {});
  const compradorId = id(corpo.compradorId, 'compradorId');
  const produtoId = id(corpo.produtoId, 'produtoId');
  const quantidade = inteiro(corpo.quantidade, 'quantidade', { min: 1, max: 10_000 });

  exigirUsuario(compradorId, 'comprador');
  const produto = exigirProduto(produtoId);

  if (produto.estoque < quantidade) {
    throw new HttpError(
      409,
      `Estoque insuficiente para "${produto.nome}". Disponível: ${produto.estoque}.`
    );
  }

  // Operação síncrona em memória: checagem e baixa acontecem sem
  // intercalação no event loop. Com banco real, isso exigiria transação.
  produto.estoque -= quantidade;

  const pedido = {
    id: proximoId('pedidos'),
    compradorId,
    produtoId,
    quantidade,
    precoUnitario: produto.preco,
    valorTotal: arredondarDinheiro(produto.preco * quantidade),
    status: 'confirmado',
    criadoEm: new Date().toISOString(),
    canceladoEm: null
  };

  db.pedidos.push(pedido);
  res.status(201).json(pedidoPublico(pedido));
});

// RF09 - Listar pedidos (filtros opcionais)
router.get('/', (req, res) => {
  let pedidos = db.pedidos;

  if (req.query.compradorId !== undefined) {
    const compradorId = id(req.query.compradorId, 'compradorId');
    pedidos = pedidos.filter((pedido) => pedido.compradorId === compradorId);
  }

  if (req.query.vendedorId !== undefined) {
    const vendedorId = id(req.query.vendedorId, 'vendedorId');
    const produtosDoVendedor = new Set(
      db.produtos
        .filter((produto) => produto.vendedorId === vendedorId)
        .map((produto) => produto.id)
    );
    pedidos = pedidos.filter((pedido) => produtosDoVendedor.has(pedido.produtoId));
  }

  if (req.query.status !== undefined) {
    const status = umDe(req.query.status, 'status', STATUS);
    pedidos = pedidos.filter((pedido) => pedido.status === status);
  }

  res.json(pedidos.map(pedidoPublico));
});

// RF10 - Consultar pedido
router.get('/:id', (req, res) => {
  const pedidoId = id(req.params.id, 'id');
  const pedido = db.pedidos.find((item) => item.id === pedidoId);

  if (!pedido) {
    throw new HttpError(404, `Pedido ${pedidoId} não encontrado.`);
  }

  res.json(pedidoPublico(pedido));
});

// RF11 - Cancelar pedido do próprio comprador e devolver o estoque
router.post('/:id/cancelar', (req, res) => {
  const pedidoId = id(req.params.id, 'id');
  const pedido = db.pedidos.find((item) => item.id === pedidoId);

  if (!pedido) {
    throw new HttpError(404, `Pedido ${pedidoId} não encontrado.`);
  }

  const corpo = corpoObjeto(req.body ?? {});
  const compradorId = id(corpo.compradorId, 'compradorId');
  exigirUsuario(compradorId, 'comprador');

  if (pedido.compradorId !== compradorId) {
    throw new HttpError(403, 'Somente o comprador que fez o pedido pode cancelá-lo.');
  }

  if (pedido.status !== 'confirmado') {
    throw new HttpError(409, `Pedido já está com status "${pedido.status}".`);
  }

  const produto = buscarProduto(pedido.produtoId);
  if (produto) {
    produto.estoque += pedido.quantidade;
  }

  pedido.status = 'cancelado';
  pedido.canceladoEm = new Date().toISOString();

  res.json(pedidoPublico(pedido));
});

export default router;
