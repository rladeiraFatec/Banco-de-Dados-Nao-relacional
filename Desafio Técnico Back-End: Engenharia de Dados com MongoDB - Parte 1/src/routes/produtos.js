import { Router } from 'express';
import { db, proximoId } from '../store.js';
import {
  arredondarDinheiro,
  booleanoDeQuery,
  corpoObjeto,
  id,
  inteiro,
  numeroPositivo,
  texto,
  textoOpcional
} from '../validacao.js';
import { HttpError } from '../errors.js';
import { exigirUsuario, produtoPublico } from '../dominio.js';

const router = Router();

// RF04 - Anunciar produto (apenas vendedor)
router.post('/', (req, res) => {
  const corpo = corpoObjeto(req.body ?? {});
  const vendedorId = id(corpo.vendedorId, 'vendedorId');
  const nome = texto(corpo.nome, 'nome', { min: 2, max: 120 });
  const descricao = textoOpcional(corpo.descricao, 'descricao', { max: 500 });
  const preco = arredondarDinheiro(numeroPositivo(corpo.preco, 'preco'));
  const estoque = inteiro(corpo.estoque, 'estoque', { min: 0, max: 1_000_000 });

  exigirUsuario(vendedorId, 'vendedor');

  const agora = new Date().toISOString();
  const produto = {
    id: proximoId('produtos'),
    vendedorId,
    nome,
    descricao,
    preco,
    estoque,
    criadoEm: agora,
    atualizadoEm: agora
  };

  db.produtos.push(produto);
  res.status(201).json(produtoPublico(produto));
});

// RF05 - Vitrine: por padrão só produtos com estoque > 0
router.get('/', (req, res) => {
  const incluirEsgotados = booleanoDeQuery(req.query.todos);
  let produtos = db.produtos;

  if (!incluirEsgotados) {
    produtos = produtos.filter((produto) => produto.estoque > 0);
  }

  if (req.query.vendedorId !== undefined) {
    const vendedorId = id(req.query.vendedorId, 'vendedorId');
    produtos = produtos.filter((produto) => produto.vendedorId === vendedorId);
  }

  if (req.query.q !== undefined) {
    const termo = String(req.query.q).trim().toLowerCase();
    if (termo !== '') {
      produtos = produtos.filter((produto) => produto.nome.toLowerCase().includes(termo));
    }
  }

  res.json(produtos.map(produtoPublico));
});

// RF06 - Detalhar produto
router.get('/:id', (req, res) => {
  const produtoId = id(req.params.id, 'id');
  const produto = db.produtos.find((item) => item.id === produtoId);

  if (!produto) {
    throw new HttpError(404, `Produto ${produtoId} não encontrado.`);
  }

  res.json(produtoPublico(produto));
});

// RF07 - Atualizar produto (somente o vendedor dono do anúncio)
router.patch('/:id', (req, res) => {
  const produtoId = id(req.params.id, 'id');
  const produto = db.produtos.find((item) => item.id === produtoId);

  if (!produto) {
    throw new HttpError(404, `Produto ${produtoId} não encontrado.`);
  }

  const corpo = corpoObjeto(req.body ?? {});
  const vendedorId = id(corpo.vendedorId, 'vendedorId');
  if (produto.vendedorId !== vendedorId) {
    throw new HttpError(403, 'Somente o vendedor responsável pelo anúncio pode alterá-lo.');
  }

  // Valida tudo antes de aplicar, para não deixar atualização pela metade.
  const alteracoes = {};
  if ('nome' in corpo) alteracoes.nome = texto(corpo.nome, 'nome', { min: 2, max: 120 });
  if ('descricao' in corpo) alteracoes.descricao = textoOpcional(corpo.descricao, 'descricao', { max: 500 });
  if ('preco' in corpo) alteracoes.preco = arredondarDinheiro(numeroPositivo(corpo.preco, 'preco'));
  if ('estoque' in corpo) alteracoes.estoque = inteiro(corpo.estoque, 'estoque', { min: 0, max: 1_000_000 });

  if (Object.keys(alteracoes).length === 0) {
    throw new HttpError(400, 'Informe ao menos um campo para atualizar: nome, descricao, preco ou estoque.');
  }

  Object.assign(produto, alteracoes, { atualizadoEm: new Date().toISOString() });
  res.json(produtoPublico(produto));
});

export default router;
