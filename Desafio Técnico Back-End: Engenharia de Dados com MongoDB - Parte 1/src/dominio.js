import { db } from './store.js';
import { HttpError } from './errors.js';

export function buscarUsuario(id) {
  return db.usuarios.find((usuario) => usuario.id === id) ?? null;
}

/** Busca o usuário e valida a existência (e, opcionalmente, o tipo). */
export function exigirUsuario(id, tipo) {
  const usuario = buscarUsuario(id);
  if (!usuario) {
    throw new HttpError(404, `Usuário ${id} não encontrado.`);
  }
  if (tipo && usuario.tipo !== tipo) {
    throw new HttpError(403, `Apenas usuários do tipo "${tipo}" podem realizar esta ação.`);
  }
  return usuario;
}

export function buscarProduto(id) {
  return db.produtos.find((produto) => produto.id === id) ?? null;
}

export function exigirProduto(id) {
  const produto = buscarProduto(id);
  if (!produto) {
    throw new HttpError(404, `Produto ${id} não encontrado.`);
  }
  return produto;
}

export function usuarioPublico(usuario) {
  return {
    id: usuario.id,
    nome: usuario.nome,
    tipo: usuario.tipo,
    criadoEm: usuario.criadoEm
  };
}

/** Produto enriquecido com os dados públicos do vendedor. */
export function produtoPublico(produto) {
  const vendedor = buscarUsuario(produto.vendedorId);
  return {
    id: produto.id,
    nome: produto.nome,
    descricao: produto.descricao,
    preco: produto.preco,
    estoque: produto.estoque,
    disponivel: produto.estoque > 0,
    vendedor: vendedor ? { id: vendedor.id, nome: vendedor.nome } : null,
    criadoEm: produto.criadoEm,
    atualizadoEm: produto.atualizadoEm
  };
}

/** Pedido enriquecido com comprador e produto (visão de leitura). */
export function pedidoPublico(pedido) {
  const comprador = buscarUsuario(pedido.compradorId);
  const produto = buscarProduto(pedido.produtoId);
  return {
    ...pedido,
    comprador: comprador ? { id: comprador.id, nome: comprador.nome } : null,
    produto: produto ? { id: produto.id, nome: produto.nome } : null
  };
}
