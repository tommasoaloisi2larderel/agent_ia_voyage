import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from './config.js';
import { catalogue, destinations, airports, emptyCriteria, filterOffers, facts } from './catalogue.js';
import { runAgent } from './agent.js';
import { AppError } from './mistral.js';
import { validate, contextSchema } from './schema.js';
import { prepareEdit } from './edits.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }

async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('Un corps JSON est requis.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128 * 1024) throw new AppError('La conversation est trop longue. Commencez une nouvelle recherche.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('Le JSON envoyé est invalide.', 400); }
}

export function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 80) throw new AppError('La conversation doit contenir entre 1 et 80 messages. Commencez une nouvelle recherche si nécessaire.', 400);
  if (messages.at(-1)?.role !== 'user') throw new AppError('Le dernier message doit être votre demande.', 400);
  return messages.map(m => {
    if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 6000) throw new AppError('Chaque message doit contenir entre 1 et 6 000 caractères.', 400);
    return { role: m.role, content: m.content.trim() };
  });
}

export function createApp({ agent = runAgent } = {}) {
  let active = 0;
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
        return json(res, 200, {
          configured: Boolean(config.apiKey), chatModel: config.chatModel, embedModel: config.embedModel,
          hotels: catalogue.length, offers: catalogue.reduce((n, h) => n + h.offres.length, 0), destinations, airports,
          criteria: emptyCriteria(), validite: { du: '2027-01-01', au: '2027-12-31' },
          apercu: filterOffers([catalogue[0], catalogue[75], catalogue[120]], emptyCriteria()),
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/catalogue') {
        const query = (url.searchParams.get('q') || '').toLocaleLowerCase('fr');
        const destination = url.searchParams.get('destination');
        const type = url.searchParams.get('type');
        const matches = catalogue.filter(h => (!destination || h.destination_id === destination) && (!type || h.type === type)
          && (!query || `${h.nom} ${h.destination} ${h.pays}`.toLocaleLowerCase('fr').includes(query)));
        const page = Math.max(0, Math.min(1000, Number.parseInt(url.searchParams.get('page') || '0', 10) || 0));
        return json(res, 200, { total: matches.length, page, hotels: filterOffers(matches.slice(page * 12, page * 12 + 12), emptyCriteria()) });
      }
      if (req.method === 'GET' && /^\/api\/hotels\/hotel-\d{3}$/.test(url.pathname)) {
        const hotel = catalogue.find(h => h.id === url.pathname.split('/').at(-1));
        if (!hotel) throw new AppError('Hôtel introuvable.', 404);
        return json(res, 200, { ...hotel, sources: facts(hotel) });
      }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new AppError('Origine non autorisée.', 403);
        if (active >= 3) throw new AppError('Plusieurs recherches sont en cours. Réessayez dans un instant.', 429);
        const { messages, context, edit } = await readBody(req);
        const validated = validateMessages(messages);
        if (context != null) {
          try { validate(context, contextSchema); }
          catch (error) {
            console.warn(`Contexte de recherche refusé : ${error.message}`);
            throw new AppError('Le contexte de recherche est invalide. Commencez une nouvelle recherche.', 400);
          }
        }
        const preparedEdit = edit == null ? null : prepareEdit(edit, context);
        if (preparedEdit) validated[validated.length - 1].content = preparedEdit.content;
        if (!config.apiKey && agent === runAgent) throw new AppError('Ajoutez MISTRAL_API_KEY dans le fichier .env, puis redémarrez le serveur.', 503);
        active++;
        const controller = new AbortController();
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        const emit = (type, data) => { if (!res.destroyed) res.write(JSON.stringify({ type, ...data }) + '\n'); };
        const heartbeat = setInterval(() => emit('heartbeat', {}), 15000);
        try {
          if (preparedEdit) emit('user', {message:preparedEdit.content});
          await agent(validated, emit, controller.signal, { previous: context, edit:preparedEdit }); emit('done', {});
        }
        catch (error) { if (!controller.signal.aborted) emit('error', { message: error.message || 'La recherche a échoué. Réessayez.' }); }
        finally { clearInterval(heartbeat); active--; res.end(); }
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new AppError('Méthode non autorisée.', 405);
      if (url.pathname.startsWith('/api/')) throw new AppError('Route introuvable.', 404);
      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = resolve(publicDir, '.' + pathname);
      if (!file.startsWith(publicDir) || !mime[extname(file)]) throw new AppError('Fichier introuvable.', 404);
      let body;
      try { body = await readFile(file); } catch { throw new AppError('Fichier introuvable.', 404); }
      res.writeHead(200, { 'Content-Type': mime[extname(file)] });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(res, error.status || 500, { error: error.status ? error.message : 'Une erreur est survenue. Réessayez dans un instant.' });
      else if (!res.writableEnded) res.end();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createApp();
  server.listen(config.port, config.host, () => {
    console.log(`FRAM · http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
    console.log(`Mistral : ${config.apiKey ? 'clé configurée' : 'ajoutez votre clé dans .env'} · ${catalogue.length} hôtels fictifs · 20 destinations`);
  });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Le port ${config.port} est déjà utilisé. Modifiez PORT dans .env.` : 'Impossible de démarrer le serveur.'); process.exitCode = 1; });
}
