/**
 * "Banco de dados" em memória.
 *
 * Os arrays são exportados por referência: quem importa `db` enxerga
 * sempre o estado atual, mesmo após `resetarBanco()`.
 * Ao reiniciar o processo, todos os dados são perdidos (proposital).
 */
const colecoes = {
  usuarios: [],
  produtos: [],
  pedidos: []
};

// Contadores separados por coleção evitam colisão de IDs.
// Diferente de `array.length + 1`, um contador monotônico não reaproveita
// IDs caso registros sejam removidos no futuro.
const contadores = { usuarios: 0, produtos: 0, pedidos: 0 };

export const db = colecoes;

export function proximoId(colecao) {
  if (!(colecao in contadores)) {
    throw new Error(`Coleção desconhecida: ${colecao}`);
  }
  contadores[colecao] += 1;
  return contadores[colecao];
}

export function resetarBanco() {
  for (const nome of Object.keys(colecoes)) {
    colecoes[nome].length = 0;
    contadores[nome] = 0;
  }
}
