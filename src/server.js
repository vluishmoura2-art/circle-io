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

const app = express();
const httpServer = http.createServer(app);

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

// Serve os arquivos estáticos do front-end (index.html, client.js, css, menu.css...).
// __dirname aqui = .../server/src, então '..', 'client' = .../server/client
app.use(express.static(path.join(__dirname, '..', 'client')));

// ==========================================
// 1. CONFIGURAÇÕES DO MUNDO (mesma escala do cliente original)
// ==========================================
const world = {
    width: 3000,
    height: 3000
};

const TICK_RATE = 1000 / 30; // 30 atualizações de física por segundo

// ==========================================
// 2. ESTADO DO JOGO (tudo vive em memória, no servidor)
// ==========================================
const players = {};
const foods = [];
const viruses = [];

const MAX_FOODS = 800;
const MAX_VIRUSES = 25;
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

function createPlayer(socketId, name) {
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
        lastInputAt: Date.now()
    };
}

const SPLIT_DEADLINE_TABLE = [
    { minScore: 5000, seconds: 20 },
    { minScore: 1000, seconds: 50 },
    { minScore: 500, seconds: 100 },
    { minScore: 200, seconds: 200 },
    { minScore: 100, seconds: 500 },
    { minScore: 0, seconds: 1000 }
];

function getSplitDeadlineTicks(score) {
    const ticksPerSecond = 1000 / TICK_RATE;
    for (let i = 0; i < SPLIT_DEADLINE_TABLE.length; i++) {
        if (score >= SPLIT_DEADLINE_TABLE[i].minScore) {
            return SPLIT_DEADLINE_TABLE[i].seconds * ticksPerSecond;
        }
    }
    return SPLIT_DEADLINE_TABLE[SPLIT_DEADLINE_TABLE.length - 1].seconds * ticksPerSecond;
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
    delete players[player.id];
}

// ==========================================
// 4. CONEXÕES SOCKET.IO
// ==========================================
io.on('connection', (socket) => {
    console.log(`[conexão] ${socket.id} conectou`);

    socket.on('join', (data) => {
        const name = data && data.name ? String(data.name) : 'Anônimo';
        players[socket.id] = createPlayer(socket.id, name);
        console.log(`[join] ${socket.id} entrou como "${name}"`);
    });

    socket.on('respawn', (data) => {
        const name = data && data.name ? String(data.name) : 'Anônimo';
        players[socket.id] = createPlayer(socket.id, name);
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

    socket.on('disconnect', () => {
        console.log(`[disconnect] ${socket.id} saiu`);
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

        for (let i = 0; i < player.cells.length; i++) {
            const cell = player.cells[i];
            const cellSpeed = Math.max(2.5, player.baseSpeed / Math.sqrt(cell.radius / 30)) * (TICK_RATE / (1000 / 60));

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
        const deadlineTicks = getSplitDeadlineTicks(score);
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
                    cell.radius += 0.4;
                    foods.push(spawnFood());
                }
            }
        }
    }

    for (let p = 0; p < playerIds.length; p++) {
        const player = players[playerIds[p]];
        if (!player || player.isDead) continue;

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
                            cellA.radius += cellB.radius * 0.25;
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
            score: getPlayerMassRadius(player)
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

httpServer.listen(PORT, () => {
    console.log(`[ball.io server] rodando na porta ${PORT}`);
    console.log(`[ball.io server] mundo: ${world.width}x${world.height} | comidas: ${MAX_FOODS} | vírus: ${MAX_VIRUSES}`);
});