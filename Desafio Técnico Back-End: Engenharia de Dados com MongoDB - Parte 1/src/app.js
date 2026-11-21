import express from 'express';
import { HttpError } from './errors.js';
import usuariosRouter from './routes/usuarios.js';
import produtosRouter from './routes/produtos.js';
import pedidosRouter from './routes/pedidos.js';

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', servico: 'marketplace-memoria', horario: new Date().toISOString() });
});

app.use('/usuarios', usuariosRouter);
app.use('/produtos', produtosRouter);
app.use('/pedidos', pedidosRouter);

// 404 em JSON para rotas inexistentes
app.use((req, res) => {
  res.status(404).json({ erro: `Rota ${req.method} ${req.originalUrl} não encontrada.` });
});

// Tratamento centralizado de erros (sempre JSON)
// eslint-disable-next-line no-unused-vars
app.use((erro, req, res, next) => {
  if (erro instanceof HttpError) {
    return res.status(erro.status).json({
      erro: erro.message,
      ...(erro.detalhes !== undefined ? { detalhes: erro.detalhes } : {})
    });
  }

  if (erro.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON inválido no corpo da requisição.' });
  }

  if (erro.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'Corpo da requisição muito grande (limite: 100kb).' });
  }

  console.error('[erro não tratado]', erro);
  return res.status(500).json({ erro: 'Erro interno do servidor.' });
});

export default app;
