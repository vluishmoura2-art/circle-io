// ==========================================
// 1. IMPORTAÇÕES E CONFIGURAÇÕES (No início)
// ==========================================
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const app = express();

app.use(express.json()); // Permite que o servidor entenda JSON

// ==========================================
// 2. CONEXÃO COM O SUPABASE (Adicione isso aqui)
// ==========================================
const supabaseUrl = 'https://sydvasdxxqezirjtwmdw.supabase.co';
const supabaseKey = 'COLE_AQUI_A_SUA_CHAVE_ANON'; // Pegue no painel do Supabase

const supabase = createClient(supabaseUrl, supabaseKey);

// ==========================================
// 3. SUAS ROTAS / ENDPOINTS
// ==========================================

// Exemplo de rota para buscar dados
app.get('/api/dados', async (req, res) => {
  // Substitua 'sua_tabela' pelo nome real da tabela que você criou no painel
  const { data, error } = await supabase.from('sua_tabela').select('*');
  
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  
  return res.json(data);
});

// Exemplo de rota para salvar dados
app.post('/api/salvar', async (req, res) => {
  const { nome, pontuacao } = req.body;

  const { data, error } = await supabase
    .from('jogadores') 
    .insert([{ nome: nome, score: pontuacao }]);

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.json({ mensagem: 'Salvo com sucesso!', data });
});

// ==========================================
// 4. INICIALIZAÇÃO DO SERVIDOR (No final do arquivo)
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
// ==========================================
// SERVER.JS — ball.io BACK-END (v31+)
// ==========================================
// Este arquivo vive em server/src/server.js.
// O front-end (HTML/CSS/JS) vive em server/client/ — uma pasta IRMÃ de src/,
// por isso o caminho abaixo usa '..' pra subir um nível antes de entrar em 'client'.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const auth = require('./auth');
const db = require('./db');
const skinsModule = require('./skins');

const app = express();
const httpServer = http.createServer(app);

// Necessário pra ler JSON no corpo das requisições de login/registro/compra
app.use(express.json());

// --- CORS: liberado por enquanto pra facilitar o teste/beta. O front-end
// (menu.html, index.html) é servido pelo PRÓPRIO Render junto com este
// servidor, então o "*" aqui não é tão arriscado quanto parece — não há
// nenhum outro domínio externo tentando se conectar de propósito. Se
// quiser travar mesmo assim, troque "*" pela URL que o Render te der
// depois do primeiro deploy (algo como https://seu-app.onrender.com).
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const PORT = process.env.PORT || 3000;

// v21: a porta de entrada do jogo é o MENU, não o jogo direto.
// Por isso a rota raiz ('/') serve explicitamente o menu.html, mesmo
// existindo um index.html (o jogo em si) dentro da mesma pasta.
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'menu.html'));
});

// Endpoint simples de "estou vivo" — útil no Render pra confirmar que o
// serviço está de pé, e também serve como destino de um possível "ping"
// externo (ex: UptimeRobot, cron-job.org) caso você queira tentar reduzir
// o sleep do free tier mantendo o serviço sempre acordado.
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        playersOnline: Object.keys(players).length,
        uptimeSeconds: Math.floor(process.uptime())
    });
});

// ==========================================
// ROTAS DE AUTENTICAÇÃO (registro/login)
// ==========================================
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await auth.register(username, password);
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        res.json({ token: result.token, user: result.user });
    } catch (err) {
        console.error('[register] erro:', err);
        res.status(500).json({ error: 'Erro interno ao registrar. Tente novamente.' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await auth.login(username, password);
        if (!result.success) {
            return res.status(401).json({ error: result.error });
        }
        res.json({ token: result.token, user: result.user });
    } catch (err) {
        console.error('[login] erro:', err);
        res.status(500).json({ error: 'Erro interno ao fazer login. Tente novamente.' });
    }
});

// Middleware simples pra validar o token JWT nas rotas que precisam de
// usuário autenticado (perfil, loja).
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token ausente.' });
    }
    const token = authHeader.slice('Bearer '.length);
    const decoded = auth.verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
}

// Retorna dados do jogador logado: saldo de Circoins e skins possuídas.
app.get('/api/me', requireAuth, async (req, res) => {
    try {
        const user = await db.findUserById(req.userId);
        if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

        const ownedSkins = await db.getUserSkins(req.userId);
        res.json({ user, ownedSkins, availableSkins: skinsModule.getAllSkins() });
    } catch (err) {
        console.error('[me] erro:', err);
        res.status(500).json({ error: 'Erro ao buscar dados do usuário.' });
    }
});

// ==========================================
// ROTA DA LOJA (compra de skins)
// ==========================================
app.post('/api/shop/purchase', requireAuth, async (req, res) => {
    try {
        const { skinId } = req.body;
        const skin = skinsModule.getSkin(skinId);
        if (!skin) {
            return res.status(400).json({ error: 'Skin inválida.' });
        }

        const result = await db.purchaseSkin(req.userId, skin.id, skin.price);

        if (!result.success) {
            const messages = {
                insufficient_funds: 'Circoins insuficientes para essa skin.',
                already_owned: 'Você já possui essa skin.'
            };
            return res.status(400).json({ error: messages[result.reason] || 'Não foi possível comprar.', circoins: result.circoins });
        }

        res.json({ success: true, circoins: result.circoins, skinId: skin.id });
    } catch (err) {
        console.error('[shop/purchase] erro:', err);
        res.status(500).json({ error: 'Erro interno ao processar a compra.' });
    }
});

// Serve os arquivos estáticos do front-end (index.html, client.js, css, menu.css...).
// __dirname aqui = .../server/src, então '..', 'client' = .../server/client
app.use(express.static(path.join(__dirname, '..', 'client')));

// ==========================================
// 1. CONFIGURAÇÕES DO MUNDO (mesma escala do cliente original)
// ==========================================
const world = {
    width: 6000,
    height: 6000
};

const TICK_RATE = 1000 / 30; // 30 atualizações de física por segundo

// ==========================================
// 2. ESTADO DO JOGO (tudo vive em memória, no servidor)
// ==========================================
const players = {};
const foods = [];
const viruses = [];

// Mapa 6000x6000 tem 4x a área do original (3000x3000), já que dobrar
// largura E altura multiplica a área por 4 (2x * 2x). Escalamos comida e
// vírus na mesma proporção pra manter a mesma densidade visual de antes.
const MAX_FOODS = 3200;   // 800 * 4
const MAX_VIRUSES = 100;  // 25 * 4
const foodColors = ['#ff3366', '#ff9933', '#ffff33', '#33ccff', '#9933ff'];

function spawnFood() {
    return {
        id: 'f_' + Math.random().toString(36).slice(2, 10),
        x: Math.random() * world.width,
        y: Math.random() * world.height,
        radius: 6,
        color: foodColors[Math.floor(Math.random() * foodColors.length)]
    };
}

function initFoods() {
    for (let i = 0; i < MAX_FOODS; i++) {
        foods.push(spawnFood());
    }
}

// --- v27: VÍRUS ---
const VIRUS_RADIUS = 90;
const VIRUS_TRIGGER_RADIUS = 110;
const VIRUS_MASS_PENALTY = 0.35;

function spawnVirus() {
    return {
        id: 'v_' + Math.random().toString(36).slice(2, 10),
        x: Math.random() * world.width,
        y: Math.random() * world.height,
        radius: VIRUS_RADIUS
    };
}

function initViruses() {
    for (let i = 0; i < MAX_VIRUSES; i++) {
        viruses.push(spawnVirus());
    }
}

// ==========================================
// 3. CRIAÇÃO E GERENCIAMENTO DE JOGADORES
// ==========================================
function createCell(x, y, radius, vx = 0, vy = 0) {
    return { x, y, radius, vx, vy, mergeTimer: 0 };
}

function createPlayer(socketId, name, userId, ownedSkins) {
    return {
        id: socketId,
        name: (name || 'Anônimo').slice(0, 16),
        color: '#00ffcc',
        baseSpeed: 8,
        isDead: false,
        cells: [
            createCell(
                Math.random() * world.width,
                Math.random() * world.height,
                30
            )
        ],
        splitTimer: 0,
        mouseX: 0,
        mouseY: 0,
        lastInputAt: Date.now(),

        // --- Conta/Circoins/Skins ---
        // userId é null para quem está jogando sem login (convidado) — esse
        // jogador simplesmente não ganha Circoins persistentes nem tem
        // acesso a skins pagas, mas pode jogar normalmente.
        userId: userId || null,
        ownedSkins: ownedSkins || [], // array de skin_id que o jogador possui
        sessionStartedAt: Date.now(), // usado pra calcular Circoins ganhos ao morrer/desconectar

        // --- Sistema de Level/XP (novo) ---
        level: 1,
        xp: 0,
        // Contagem de quantas vezes cada habilidade foi escolhida. Cada
        // escolha empilha +20% de bônus, sem teto (confirmado pelo design).
        abilityCounts: {
            speed: 0,       // +20% de velocidade por escolha
            consumption: 0, // +20% de ganho de massa ao comer, por escolha
            immunity: 0     // +20% de tempo extra no contador de split, por escolha
        },
        // Quando o jogador sobe de nível, fica "pendente" até ele escolher
        // uma das 3 opções pelo painel na tela. Pode acumular mais de um
        // nível pendente se subir rápido (ex: comeu um jogador grande).
        pendingLevelUps: 0
    };
}

// --- Sistema de Circoins ---
// 1 Circoin por minuto vivo = (1/60) Circoin por segundo. Convertido pra
// "por tick" do mesmo jeito que o XP, lá na seção de Level/XP abaixo.
const CIRCOINS_PER_MINUTE = 1;

// Credita no banco os Circoins ganhos durante a sessão que está terminando
// (morte ou desconexão). Joga fora silenciosamente se o jogador não tiver
// conta (userId null) ou se o banco não estiver configurado.
async function creditSessionCircoins(player) {
    if (!player.userId || !db.pool) return;

    const sessionSeconds = (Date.now() - player.sessionStartedAt) / 1000;
    const earned = Math.floor((sessionSeconds / 60) * CIRCOINS_PER_MINUTE);

    if (earned <= 0) return;

    try {
        await db.addCircoins(player.userId, earned);
        console.log(`[circoins] usuário ${player.userId} ganhou ${earned} Circoins (${sessionSeconds.toFixed(0)}s de sessão).`);
    } catch (err) {
        console.error('[circoins] erro ao creditar:', err);
    }
}

// --- Sistema de Level/XP ---
// XP ganho por segundo vivo. Curva calculada pra ~10 minutos de jogo
// contínuo até o nível 100 (ver xpNeededForLevel). O servidor roda a
// (1000 / TICK_RATE) ticks por segundo, então damos uma fração de XP a
// cada tick que, somada ao longo de 1 segundo, dá exatamente 1.0 XP.
const TICKS_PER_SECOND = 1000 / TICK_RATE;
const XP_PER_TICK = 1 / TICKS_PER_SECOND;
const XP_BASE = 1.0;
const XP_GROWTH = 1.03;
const MAX_LEVEL = 100;

function xpNeededForLevel(level) {
    // XP necessário para subir DO nível `level` PARA o `level + 1`.
    return XP_BASE * Math.pow(XP_GROWTH, level - 1);
}

// Bônus acumulado de cada habilidade, em multiplicador (0.20 = +20%)
const ABILITY_BONUS_PER_PICK = 0.20;

function getSpeedMultiplier(player) {
    return 1 + (player.abilityCounts.speed * ABILITY_BONUS_PER_PICK);
}

function getConsumptionMultiplier(player) {
    return 1 + (player.abilityCounts.consumption * ABILITY_BONUS_PER_PICK);
}

function getImmunityMultiplier(player) {
    return 1 + (player.abilityCounts.immunity * ABILITY_BONUS_PER_PICK);
}

// Skin Elétrica: efeito de gameplay real (não só cosmético) — verifica se
// o jogador possui a skin 'electric' entre as skins carregadas do banco
// no momento do join/respawn (player.ownedSkins).
function hasVirusImmunity(player) {
    return player.ownedSkins && player.ownedSkins.includes('electric');
}

function addXp(player, amount) {
    if (player.isDead || player.level >= MAX_LEVEL) return;

    player.xp += amount;

    // Pode subir mais de um nível de uma vez se ganhar muito XP de uma vez
    // (proteção de loop, embora hoje XP só venha de tempo vivo, 1 por tick)
    while (player.level < MAX_LEVEL) {
        const needed = xpNeededForLevel(player.level);
        if (player.xp >= needed) {
            player.xp -= needed;
            player.level++;
            player.pendingLevelUps++;
        } else {
            break;
        }
    }
}

// Tabela atualizada: tempos mais curtos/agressivos que a versão original,
// já compensados pelo sistema de níveis (a habilidade de "imunidade ao
// contador" pode estender esses limites conforme o jogador sobe de nível).
const SPLIT_DEADLINE_TABLE = [
    { minScore: 5000, seconds: 5 },
    { minScore: 1000, seconds: 10 },
    { minScore: 500, seconds: 20 },
    { minScore: 200, seconds: 30 },
    { minScore: 100, seconds: 40 },
    { minScore: 0, seconds: 50 }
];

function getSplitDeadlineTicks(score, immunityMultiplier) {
    const ticksPerSecond = 1000 / TICK_RATE;
    let baseSeconds = SPLIT_DEADLINE_TABLE[SPLIT_DEADLINE_TABLE.length - 1].seconds;

    for (let i = 0; i < SPLIT_DEADLINE_TABLE.length; i++) {
        if (score >= SPLIT_DEADLINE_TABLE[i].minScore) {
            baseSeconds = SPLIT_DEADLINE_TABLE[i].seconds;
            break;
        }
    }

    // Habilidade "Imunidade ao contador": +20% de TEMPO no limite, por
    // escolha, acumulado sem teto (ex: 50s vira 60s, depois 70s...).
    return baseSeconds * immunityMultiplier * ticksPerSecond;
}

function getPlayerMassRadius(player) {
    let totalArea = 0;
    for (let i = 0; i < player.cells.length; i++) {
        totalArea += player.cells[i].radius * player.cells[i].radius;
    }
    return Math.sqrt(totalArea);
}

function getPlayerCenter(player) {
    let sumX = 0, sumY = 0, totalWeight = 0;
    for (let i = 0; i < player.cells.length; i++) {
        const cell = player.cells[i];
        const weight = cell.radius * cell.radius;
        sumX += cell.x * weight;
        sumY += cell.y * weight;
        totalWeight += weight;
    }
    if (totalWeight === 0) return { x: world.width / 2, y: world.height / 2 };
    return { x: sumX / totalWeight, y: sumY / totalWeight };
}

const MIN_SPLIT_RADIUS = 35;
const MAX_CELLS = 16;
const SPLIT_IMPULSE = 7;
const MERGE_TIME_TICKS = Math.round(15 * (1000 / TICK_RATE));

function splitPlayer(player) {
    if (player.isDead) return;

    const newCells = [];

    for (let i = 0; i < player.cells.length; i++) {
        const cell = player.cells[i];

        if (cell.radius >= MIN_SPLIT_RADIUS && (player.cells.length + newCells.length) < MAX_CELLS) {
            const newRadius = cell.radius / Math.sqrt(2);

            const dirX = player.mouseX;
            const dirY = player.mouseY;
            const dirDist = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
            const normX = dirX / dirDist;
            const normY = dirY / dirDist;

            cell.radius = newRadius;
            cell.mergeTimer = MERGE_TIME_TICKS;

            const spawnOffset = newRadius;
            const newCell = createCell(
                cell.x + normX * spawnOffset,
                cell.y + normY * spawnOffset,
                newRadius,
                normX * SPLIT_IMPULSE,
                normY * SPLIT_IMPULSE
            );
            newCell.mergeTimer = MERGE_TIME_TICKS;

            newCells.push(newCell);
        }
    }

    for (let i = 0; i < newCells.length; i++) {
        player.cells.push(newCells[i]);
    }

    if (newCells.length > 0) {
        player.splitTimer = 0;
    }
}

function killPlayer(player, reason) {
    player.isDead = true;
    player.deathReason = reason;
    const socket = io.sockets.sockets.get(player.id);
    if (socket) {
        socket.emit('death', { reason: reason });
    }

    // Credita Circoins da sessão que está terminando (não bloqueia a
    // remoção do jogador — roda em paralelo, é "fire and forget" aqui
    // porque já vamos deletar o objeto de qualquer forma).
    creditSessionCircoins(player);

    delete players[player.id];
}

// ==========================================
// 4. CONEXÕES SOCKET.IO
// ==========================================
io.on('connection', (socket) => {
    console.log(`[conexão] ${socket.id} conectou`);

    // Resolve o token JWT (se enviado) em userId + lista de skins
    // possuídas. Jogadores sem token continuam podendo jogar como
    // "convidados" — só não acumulam Circoins nem usam skins pagas.
    async function resolvePlayerIdentity(data) {
        let userId = null;
        let ownedSkins = [];

        const token = data && data.token;
        if (token) {
            const decoded = auth.verifyToken(token);
            if (decoded) {
                userId = decoded.userId;
                try {
                    ownedSkins = await db.getUserSkins(userId);
                } catch (err) {
                    console.error('[resolvePlayerIdentity] erro ao buscar skins:', err);
                }
            }
        }

        return { userId, ownedSkins };
    }

    socket.on('join', async (data) => {
        const name = data && data.name ? String(data.name) : 'Anônimo';
        const { userId, ownedSkins } = await resolvePlayerIdentity(data);
        players[socket.id] = createPlayer(socket.id, name, userId, ownedSkins);
        console.log(`[join] ${socket.id} entrou como "${name}"${userId ? ` (conta #${userId})` : ' (convidado)'}`);
    });

    socket.on('respawn', async (data) => {
        const name = data && data.name ? String(data.name) : 'Anônimo';
        const { userId, ownedSkins } = await resolvePlayerIdentity(data);
        players[socket.id] = createPlayer(socket.id, name, userId, ownedSkins);
    });

    socket.on('input', (data) => {
        const player = players[socket.id];
        if (!player || player.isDead) return;
        if (typeof data.x !== 'number' || typeof data.y !== 'number') return;

        player.mouseX = data.x;
        player.mouseY = data.y;
        player.lastInputAt = Date.now();
    });

    socket.on('split', () => {
        const player = players[socket.id];
        if (!player || player.isDead) return;
        splitPlayer(player);
    });

    // Sistema de Level/XP: o cliente manda qual das 3 habilidades o
    // jogador escolheu no painel que aparece ao subir de nível.
    socket.on('choose_ability', (data) => {
        const player = players[socket.id];
        if (!player || player.isDead) return;
        if (player.pendingLevelUps <= 0) return; // não há nível pendente, ignora

        const validAbilities = ['speed', 'consumption', 'immunity'];
        if (!validAbilities.includes(data.ability)) return;

        player.abilityCounts[data.ability]++;
        player.pendingLevelUps--;
    });

    socket.on('disconnect', () => {
        console.log(`[disconnect] ${socket.id} saiu`);
        const player = players[socket.id];
        if (player && !player.isDead) {
            // Jogador saiu sem morrer (fechou a aba, etc) — ainda credita
            // os Circoins ganhos até aqui, igual ao que acontece na morte.
            creditSessionCircoins(player);
        }
        delete players[socket.id];
    });
});

// ==========================================
// 5. LOOP DE FÍSICA
// ==========================================
function updatePhysics() {
    const playerIds = Object.keys(players);

    for (let p = 0; p < playerIds.length; p++) {
        const player = players[playerIds[p]];
        if (player.isDead) continue;

        // Sistema de Level/XP: ganha XP a cada tick que estiver vivo,
        // equivalente a 1 XP por segundo de vida.
        addXp(player, XP_PER_TICK);

        for (let i = 0; i < player.cells.length; i++) {
            const cell = player.cells[i];
            const baseCellSpeed = Math.max(2.5, player.baseSpeed / Math.sqrt(cell.radius / 30)) * (TICK_RATE / (1000 / 60));
            // Habilidade "Velocidade": +20% por escolha, acumulado sem teto.
            const cellSpeed = baseCellSpeed * getSpeedMultiplier(player);

            const dx = player.mouseX;
            const dy = player.mouseY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            let moveX = 0;
            let moveY = 0;

            if (distance > 1) {
                const ease = 0.08;
                moveX = dx * ease;
                moveY = dy * ease;

                const moveDistance = Math.sqrt(moveX * moveX + moveY * moveY);
                if (moveDistance > cellSpeed) {
                    moveX = (moveX / moveDistance) * cellSpeed;
                    moveY = (moveY / moveDistance) * cellSpeed;
                }
            }

            cell.x += moveX + cell.vx;
            cell.y += moveY + cell.vy;

            const impulseFriction = 0.90;
            cell.vx *= impulseFriction;
            cell.vy *= impulseFriction;
            if (Math.abs(cell.vx) < 0.05) cell.vx = 0;
            if (Math.abs(cell.vy) < 0.05) cell.vy = 0;

            if (cell.x < cell.radius) cell.x = cell.radius;
            if (cell.x > world.width - cell.radius) cell.x = world.width - cell.radius;
            if (cell.y < cell.radius) cell.y = cell.radius;
            if (cell.y > world.height - cell.radius) cell.y = world.height - cell.radius;
        }

        for (let i = 0; i < player.cells.length; i++) {
            if (player.cells[i].mergeTimer > 0) player.cells[i].mergeTimer--;
        }

        for (let i = player.cells.length - 1; i >= 0; i--) {
            for (let j = i - 1; j >= 0; j--) {
                const a = player.cells[i];
                const b = player.cells[j];
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;

                const bothCanMerge = a.mergeTimer === 0 && b.mergeTimer === 0;
                const mergeThreshold = Math.max(a.radius, b.radius);

                if (bothCanMerge && dist < mergeThreshold) {
                    const mergedArea = (a.radius * a.radius) + (b.radius * b.radius);
                    const mergedRadius = Math.sqrt(mergedArea);

                    const weightA = a.radius * a.radius;
                    const weightB = b.radius * b.radius;
                    const totalWeight = weightA + weightB;

                    a.x = (a.x * weightA + b.x * weightB) / totalWeight;
                    a.y = (a.y * weightA + b.y * weightB) / totalWeight;
                    a.radius = mergedRadius;
                    a.vx = 0;
                    a.vy = 0;

                    player.cells.splice(j, 1);
                    i--;
                    break;
                } else {
                    const minDist = (a.radius + b.radius) * 0.85;
                    if (dist < minDist) {
                        const overlap = (minDist - dist) / 2;
                        const pushX = (dx / dist) * overlap;
                        const pushY = (dy / dist) * overlap;
                        a.x += pushX;
                        a.y += pushY;
                        b.x -= pushX;
                        b.y -= pushY;
                    }
                }
            }
        }

        player.splitTimer++;
        const score = getPlayerMassRadius(player);
        const deadlineTicks = getSplitDeadlineTicks(score, getImmunityMultiplier(player));
        if (player.splitTimer >= deadlineTicks) {
            killPlayer(player, 'timer');
            continue;
        }
    }

    for (let p = 0; p < playerIds.length; p++) {
        const player = players[playerIds[p]];
        if (!player || player.isDead) continue;

        for (let c = 0; c < player.cells.length; c++) {
            const cell = player.cells[c];

            for (let f = foods.length - 1; f >= 0; f--) {
                const food = foods[f];
                const dx = cell.x - food.x;
                const dy = cell.y - food.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < cell.radius) {
                    foods.splice(f, 1);
                    // Habilidade "Consumo de pontos": +20% de massa ganha
                    // por comida comida, por escolha, acumulado sem teto.
                    cell.radius += 0.4 * getConsumptionMultiplier(player);
                    foods.push(spawnFood());
                }
            }
        }
    }

    for (let p = 0; p < playerIds.length; p++) {
        const player = players[playerIds[p]];
        if (!player || player.isDead) continue;

        // Skin Elétrica: invulnerabilidade PERMANENTE a vírus, conforme
        // comprado na loja. Jogadores sem essa skin sofrem o efeito normal.
        if (hasVirusImmunity(player)) continue;

        for (let c = 0; c < player.cells.length; c++) {
            const cell = player.cells[c];
            if (cell.radius < VIRUS_TRIGGER_RADIUS) continue;

            for (let v = 0; v < viruses.length; v++) {
                const virus = viruses[v];
                const dx = cell.x - virus.x;
                const dy = cell.y - virus.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < cell.radius + virus.radius * 0.4) {
                    const area = cell.radius * cell.radius;
                    const newArea = area * (1 - VIRUS_MASS_PENALTY);
                    cell.radius = Math.max(20, Math.sqrt(newArea));

                    virus.x = Math.random() * world.width;
                    virus.y = Math.random() * world.height;
                }
            }
        }
    }

    for (let p1 = 0; p1 < playerIds.length; p1++) {
        const playerA = players[playerIds[p1]];
        if (!playerA || playerA.isDead) continue;

        for (let p2 = 0; p2 < playerIds.length; p2++) {
            if (p1 === p2) continue;
            const playerB = players[playerIds[p2]];
            if (!playerB || playerB.isDead) continue;

            for (let ca = playerA.cells.length - 1; ca >= 0; ca--) {
                const cellA = playerA.cells[ca];
                if (!cellA) continue;

                for (let cb = playerB.cells.length - 1; cb >= 0; cb--) {
                    const cellB = playerB.cells[cb];
                    if (!cellB) continue;

                    const dx = cellA.x - cellB.x;
                    const dy = cellA.y - cellB.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < cellA.radius + cellB.radius) {
                        if (cellA.radius > cellB.radius * 1.1) {
                            // Habilidade "Consumo de pontos" também se aplica
                            // ao comer outros jogadores, não só comida.
                            cellA.radius += cellB.radius * 0.25 * getConsumptionMultiplier(playerA);
                            playerB.cells.splice(cb, 1);
                            if (playerB.cells.length === 0) {
                                killPlayer(playerB, 'eaten');
                            }
                        }
                    }
                }
            }
        }
    }
}

setInterval(updatePhysics, TICK_RATE);

// ==========================================
// 6. BROADCAST DO ESTADO DO JOGO
// ==========================================
const BROADCAST_RATE = 1000 / 20;

function buildLeaderboard() {
    const entries = Object.keys(players).map((id) => {
        const player = players[id];
        return {
            id: id,
            name: player.name,
            score: Math.floor(getPlayerMassRadius(player))
        };
    });

    entries.sort((a, b) => b.score - a.score);
    return entries.slice(0, 10);
}

function broadcastState() {
    const playerIds = Object.keys(players);
    const playersPayload = {};

    for (let i = 0; i < playerIds.length; i++) {
        const player = players[playerIds[i]];
        playersPayload[player.id] = {
            name: player.name,
            color: player.color,
            isDead: player.isDead,
            cells: player.cells,
            splitTimer: player.splitTimer,
            score: getPlayerMassRadius(player),

            // Sistema de Level/XP
            level: player.level,
            xp: player.xp,
            xpNeeded: player.level < MAX_LEVEL ? xpNeededForLevel(player.level) : 0,
            pendingLevelUps: player.pendingLevelUps,
            abilityCounts: player.abilityCounts,

            // Skins (efeito visual no cliente; o efeito de gameplay real
            // já é decidido no servidor, isso aqui é só pra exibição)
            ownedSkins: player.ownedSkins
        };
    }

    const leaderboard = buildLeaderboard();

    io.sockets.sockets.forEach((socket) => {
        socket.emit('state', {
            players: playersPayload,
            foods: foods,
            viruses: viruses,
            leaderboard: leaderboard,
            world: world
        });
    });
}

setInterval(broadcastState, BROADCAST_RATE);

// ==========================================
// 7. REINÍCIO PROGRAMADO DE 24H — REMOVIDO NESTA VERSÃO (Render)
// ==========================================
// Na versão Hostinger/PM2, este servidor tinha um process.exit() agendado
// a cada 24h, porque ali você controla o uptime e queria essa rotina.
// No Render, isso é redundante e pode até confundir: o próprio Render já
// derruba e reinicia o processo sozinho quando o serviço "dorme" por
// inatividade (free tier) ou em deploys novos. Manter os dois reinícios
// rodando ao mesmo tempo só geraria reinícios duplicados sem motivo.

// ==========================================
// 8. INICIALIZAÇÃO
// ==========================================
initFoods();
initViruses();

async function startServer() {
    try {
        await db.initSchema();
    } catch (err) {
        console.error('[db] erro ao inicializar schema (login/Circoins não vão funcionar):', err);
    }

    httpServer.listen(PORT, () => {
        console.log(`[ball.io server] rodando na porta ${PORT}`);
        console.log(`[ball.io server] mundo: ${world.width}x${world.height} | comidas: ${MAX_FOODS} | vírus: ${MAX_VIRUSES}`);
    });
}

startServer();

