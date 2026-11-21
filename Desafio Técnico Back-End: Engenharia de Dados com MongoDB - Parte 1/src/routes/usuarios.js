import { Router } from 'express';
import { db, proximoId } from '../store.js';
import { corpoObjeto, id, texto, umDe } from '../validacao.js';
import { HttpError } from '../errors.js';
import { usuarioPublico } from '../dominio.js';

const router = Router();
const TIPOS = ['vendedor', 'comprador'];

// RF01 - Cadastrar usuário (vendedor ou comprador)
router.post('/', (req, res) => {
  const corpo = corpoObjeto(req.body ?? {});
  const nome = texto(corpo.nome, 'nome', { min: 2, max: 120 });
  const tipo = umDe(corpo.tipo, 'tipo', TIPOS);

  const usuario = {
    id: proximoId('usuarios'),
    nome,
    tipo,
    criadoEm: new Date().toISOString()
  };

  db.usuarios.push(usuario);
  res.status(201).json(usuarioPublico(usuario));
});

// RF02 - Listar usuários (filtro opcional por tipo)
router.get('/', (req, res) => {
  let usuarios = db.usuarios;

  if (req.query.tipo !== undefined) {
    const tipo = umDe(req.query.tipo, 'tipo', TIPOS);
    usuarios = usuarios.filter((usuario) => usuario.tipo === tipo);
  }

  res.json(usuarios.map(usuarioPublico));
});

// RF03 - Consultar usuário por ID
router.get('/:id', (req, res) => {
  const usuarioId = id(req.params.id, 'id');
  const usuario = db.usuarios.find((item) => item.id === usuarioId);

  if (!usuario) {
    throw new HttpError(404, `Usuário ${usuarioId} não encontrado.`);
  }

  res.json(usuarioPublico(usuario));
});

export default router;
