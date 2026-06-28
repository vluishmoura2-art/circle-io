// ==========================================
// CLIENT.JS — ball.io FRONT-END EM REDE (v31 a v38)
// ==========================================
// A partir daqui o cliente NÃO simula mais física, colisão ou crescimento.
// Ele só: (1) manda input pro servidor, e (2) desenha o que o servidor manda
// de volta. Toda a "verdade" do jogo mora no server.js.

// --- GUARDA DE ENTRADA: exige nome vindo do menu.html ---
// Lê o nome enviado pelo menu via parâmetro de URL (?name=...). Se alguém
// abrir index.html direto, sem passar pelo menu, manda de volta pro menu
// antes de conectar no servidor ou tocar no canvas.
const urlParams = new URLSearchParams(window.location.search);
const nameFromUrl = urlParams.get('name');

if (!nameFromUrl || nameFromUrl.trim().length === 0) {
    window.location.href = 'menu.html';
    throw new Error('Nome ausente — redirecionando para o menu.');
}

const myName = nameFromUrl.trim().slice(0, 16);

// ==========================================
// 1. CONFIGURAÇÕES INICIAIS E CANVAS
// ==========================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- v31: IMPORTAÇÃO DO SOCKET.IO ---
// O <script src="/socket.io/socket.io.js"></script> precisa estar no HTML
// antes deste arquivo (o servidor Express já serve esse script automaticamente).
const socket = io(); // por padrão conecta no mesmo host/porta que serviu a página

// --- ESTADO RECEBIDO DO SERVIDOR (preenchido pelo evento 'state') ---
let serverState = {
    players: {},
    foods: [],
    viruses: [],
    leaderboard: [],
    world: { width: 3000, height: 3000 }
};

// v35: snapshot anterior, usado pra interpolar (Lerp) entre updates de rede
let previousState = null;
let lastStateReceivedAt = Date.now();

let myId = null;
let connectionStatus = 'connecting'; // 'connecting' | 'connected' | 'disconnected'
let isDead = false;
let deathReason = '';

// --- SISTEMA DE CÂMERA ---
const camera = { x: 0, y: 0 };


// --- CONTROLE DO MOUSE ---
const mouse = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2
};

window.addEventListener('mousemove', (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
});

// --- v23: TECLA ESPAÇO (agora só avisa o servidor, não divide localmente) ---
window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
        event.preventDefault();
        if (!isDead) socket.emit('split');
    }
});

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ==========================================
// 2. CONEXÃO E EVENTOS DO SOCKET.IO (v31-v34, v39)
// ==========================================
socket.on('connect', () => {
    myId = socket.id;
    connectionStatus = 'connected';
    console.log('[socket] conectado:', myId);
    socket.emit('join', { name: myName });
});

socket.on('state', (state) => {
    previousState = serverState;
    serverState = state;
    lastStateReceivedAt = Date.now();
});

socket.on('death', (data) => {
    isDead = true;
    deathReason = data.reason || 'eaten';

    // Respawna automaticamente depois de 3s, mesma UX que o protótipo local já tinha
    setTimeout(() => {
        isDead = false;
        socket.emit('respawn', { name: myName });
    }, 3000);
});

// v39: tratamento de desconexão — avisa visualmente, tenta reconectar sozinho
// (o próprio Socket.io já tenta reconectar por padrão; aqui só atualizamos a UI)
socket.on('disconnect', () => {
    connectionStatus = 'disconnected';
});

socket.on('reconnect', () => {
    connectionStatus = 'connected';
    socket.emit('join', { name: myName });
});

socket.on('reconnect_attempt', () => {
    connectionStatus = 'connecting';
});

// Avisos do servidor sobre a rotina de reinício de 24h
socket.on('server_restart_warning', (data) => {
    serverRestartWarningSeconds = data.secondsUntilRestart || 60;
});

socket.on('server_restart_now', () => {
    serverRestartWarningSeconds = 0;
    connectionStatus = 'disconnected';
});

let serverRestartWarningSeconds = null;

// ==========================================
// 3. ENVIO DE INPUT (v33)
// ==========================================
// Não mandamos a posição final do jogador — mandamos só a direção/distância
// do mouse em relação ao centro da tela. O servidor decide o resultado do
// movimento. Isso é o que torna o servidor autoritativo de verdade.
const INPUT_SEND_RATE = 1000 / 20; // 20 envios de input por segundo é suficiente

setInterval(() => {
    if (connectionStatus !== 'connected' || isDead) return;

    socket.emit('input', {
        x: mouse.x - canvas.width / 2,
        y: mouse.y - canvas.height / 2
    });
}, INPUT_SEND_RATE);

// ==========================================
// 4. INTERPOLAÇÃO (v35)
// ==========================================
// Como o servidor só manda updates ~20x/س (e a física roda a 30 ticks/s),
// sem suavização o movimento dos outros jogadores pareceria "engasgado".
// Por isso interpolamos (Lerp) entre o snapshot anterior e o atual.
function lerp(a, b, t) {
    return a + (b - a) * t;
}

function getInterpolationFactor() {
    const elapsed = Date.now() - lastStateReceivedAt;
    const t = elapsed / INPUT_SEND_RATE; // aproxima o intervalo entre snapshots
    return Math.min(1, Math.max(0, t));
}

function getInterpolatedCells(currentPlayer, previousPlayer, t) {
    if (!previousPlayer || previousPlayer.cells.length !== currentPlayer.cells.length) {
        // Número de células mudou (split/merge aconteceu) — não dá pra interpolar
        // ponto-a-ponto com segurança, então só usa a posição mais recente.
        return currentPlayer.cells;
    }

    return currentPlayer.cells.map((cell, i) => {
        const prevCell = previousPlayer.cells[i];
        return {
            x: lerp(prevCell.x, cell.x, t),
            y: lerp(prevCell.y, cell.y, t),
            radius: lerp(prevCell.radius, cell.radius, t),
            mergeTimer: cell.mergeTimer
        };
    });
}

// ==========================================
// 5. FUNÇÕES AUXILIARES DE MASSA/CENTRO (mesma lógica do cliente local)
// ==========================================
function getMassRadius(cells) {
    let totalArea = 0;
    for (let i = 0; i < cells.length; i++) {
        totalArea += cells[i].radius * cells[i].radius;
    }
    return Math.sqrt(totalArea);
}

function getBiggestCell(cells) {
    let biggest = cells[0];
    for (let i = 1; i < cells.length; i++) {
        if (cells[i].radius > biggest.radius) biggest = cells[i];
    }
    return biggest;
}

function getCenter(cells) {
    let sumX = 0, sumY = 0, totalWeight = 0;
    for (let i = 0; i < cells.length; i++) {
        const weight = cells[i].radius * cells[i].radius;
        sumX += cells[i].x * weight;
        sumY += cells[i].y * weight;
        totalWeight += weight;
    }
    if (totalWeight === 0) return { x: 0, y: 0 };
    return { x: sumX / totalWeight, y: sumY / totalWeight };
}

// ==========================================
// 6. RENDERIZAÇÃO (v34, v36, v37, v38, v40)
// ==========================================
function drawGame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#101014';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const me = myId ? serverState.players[myId] : null;
    const prevMe = (myId && previousState) ? previousState.players[myId] : null;
    const t = getInterpolationFactor();

    let myCells = [];
    if (me && !me.isDead) {
        myCells = getInterpolatedCells(me, prevMe, t);
        const center = getCenter(myCells);
        camera.x = center.x - canvas.width / 2;
        camera.y = center.y - canvas.height / 2;
    }

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Chão e bordas do mundo
    const world = serverState.world;
    ctx.fillStyle = '#15151a';
    ctx.fillRect(0, 0, world.width, world.height);
    ctx.strokeStyle = '#ff3333';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, world.width, world.height);

    // v40: culling simples — só desenha o que está perto da câmera/tela
    const viewMargin = 100;
    const viewLeft = camera.x - viewMargin;
    const viewRight = camera.x + canvas.width + viewMargin;
    const viewTop = camera.y - viewMargin;
    const viewBottom = camera.y + canvas.height + viewMargin;

    function isVisible(x, y, r) {
        return x + r > viewLeft && x - r < viewRight && y + r > viewTop && y - r < viewBottom;
    }

    // Comidas (v36: lendo array enviado pelo servidor)
    for (let i = 0; i < serverState.foods.length; i++) {
        const food = serverState.foods[i];
        if (!isVisible(food.x, food.y, food.radius)) continue;
        ctx.beginPath();
        ctx.arc(food.x, food.y, food.radius, 0, Math.PI * 2);
        ctx.fillStyle = food.color;
        ctx.fill();
        ctx.closePath();
    }

    // v27: Vírus
    for (let i = 0; i < serverState.viruses.length; i++) {
        const virus = serverState.viruses[i];
        if (!isVisible(virus.x, virus.y, virus.radius)) continue;
        drawVirusSpikes(virus);
    }

    // v37: Outros jogadores enviados pelo servidor
    const playerIds = Object.keys(serverState.players);
    for (let i = 0; i < playerIds.length; i++) {
        const id = playerIds[i];
        if (id === myId) continue; // o "eu" é desenhado separado, com interpolação própria

        const otherPlayer = serverState.players[id];
        if (otherPlayer.isDead) continue;

        const prevOther = previousState ? previousState.players[id] : null;
        const cells = getInterpolatedCells(otherPlayer, prevOther, t);

        const anyVisible = cells.some((c) => isVisible(c.x, c.y, c.radius));
        if (!anyVisible) continue;

        for (let c = 0; c < cells.length; c++) {
            const cell = cells[c];
            ctx.beginPath();
            ctx.arc(cell.x, cell.y, cell.radius, 0, Math.PI * 2);
            ctx.fillStyle = otherPlayer.color || '#cc4444';
            ctx.fill();
            ctx.closePath();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        const mainCell = getBiggestCell(cells);
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(otherPlayer.name, mainCell.x, mainCell.y - mainCell.radius - 5);
    }

    // Eu mesmo, por último, pra ficar sempre visível por cima dos outros
    if (me && !me.isDead && myCells.length > 0) {
        for (let i = 0; i < myCells.length; i++) {
            const cell = myCells[i];
            ctx.beginPath();
            ctx.arc(cell.x, cell.y, cell.radius, 0, Math.PI * 2);
            ctx.fillStyle = '#00ffcc';
            ctx.fill();
            ctx.closePath();
            ctx.strokeStyle = cell.mergeTimer > 0 ? '#33fff0' : '#007a66';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        const mainCell = getBiggestCell(myCells);
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(myName, mainCell.x, mainCell.y - mainCell.radius - 5);
    }

    ctx.restore();

    drawUI(me);
    drawLeaderboard();
    drawConnectionBanner();

    if (isDead) {
        drawGameOver();
    }
}

function drawVirusSpikes(virus) {
    const spikeCount = 18;
    const innerRadius = virus.radius * 0.82;

    ctx.beginPath();
    for (let i = 0; i < spikeCount * 2; i++) {
        const angle = (Math.PI * 2 * i) / (spikeCount * 2);
        const r = i % 2 === 0 ? virus.radius : innerRadius;
        const px = virus.x + Math.cos(angle) * r;
        const py = virus.y + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#33cc33';
    ctx.fill();
    ctx.strokeStyle = '#1f8a1f';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawUI(me) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';

    const score = me ? Math.floor(getMassRadius(me.cells)) : 0;
    const cellCount = me ? me.cells.length : 0;
    ctx.fillText(`ball.io | Tamanho: ${score} | Pedaços: ${cellCount}`, canvas.width / 2, 40);

    if (me && !isDead) {
        // O servidor já manda splitTimer pronto; só precisamos saber o limite
        // da faixa atual pra calcular quanto tempo falta — replicando a mesma
        // tabela do v26 aqui no cliente, só para exibição (o servidor é quem
        // de fato decide a morte).
        const deadlineSeconds = getClientSideDeadlineSeconds(score);
        const secondsElapsed = me.splitTimer / 30; // 30 ticks/s no servidor
        const secondsLeft = Math.max(0, Math.ceil(deadlineSeconds - secondsElapsed));

        const isUrgent = secondsLeft <= 5;
        ctx.fillStyle = isUrgent ? '#ff3333' : '#ffcc00';
        ctx.font = isUrgent ? 'bold 18px Arial' : '16px Arial';
        ctx.fillText(`Divida em: ${secondsLeft}s`, canvas.width / 2, 65);
    }
}

const SPLIT_DEADLINE_TABLE_CLIENT = [
    { minScore: 5000, seconds: 20 },
    { minScore: 1000, seconds: 50 },
    { minScore: 500, seconds: 100 },
    { minScore: 200, seconds: 200 },
    { minScore: 100, seconds: 500 },
    { minScore: 0, seconds: 1000 }
];

function getClientSideDeadlineSeconds(score) {
    for (let i = 0; i < SPLIT_DEADLINE_TABLE_CLIENT.length; i++) {
        if (score >= SPLIT_DEADLINE_TABLE_CLIENT[i].minScore) {
            return SPLIT_DEADLINE_TABLE_CLIENT[i].seconds;
        }
    }
    return SPLIT_DEADLINE_TABLE_CLIENT[SPLIT_DEADLINE_TABLE_CLIENT.length - 1].seconds;
}

// v38: leaderboard agora vem pronto do servidor (dados reais dos jogadores conectados)
function drawLeaderboard() {
    const leaderboard = serverState.leaderboard || [];

    const startX = canvas.width - 220;
    const startY = 30;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(startX, startY, 190, 180);

    ctx.fillStyle = '#ffcc00';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('LEADERBOARD', startX + 15, startY + 25);

    ctx.font = '14px Arial';
    const maxEntries = Math.min(leaderboard.length, 5);
    for (let i = 0; i < maxEntries; i++) {
        const entry = leaderboard[i];
        ctx.fillStyle = (entry.id === myId) ? '#00ffcc' : '#ffffff';
        const text = `${i + 1}. ${entry.name}: ${entry.score}`;
        ctx.fillText(text, startX + 15, startY + 55 + (i * 22));
    }
}

// v39: aviso visual de desconexão / reinício programado do servidor
function drawConnectionBanner() {
    if (connectionStatus === 'connected' && serverRestartWarningSeconds === null) return;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, canvas.height - 50, canvas.width, 50);

    ctx.font = '16px Arial';
    ctx.textAlign = 'center';

    if (connectionStatus === 'disconnected') {
        ctx.fillStyle = '#ff3333';
        ctx.fillText('Conexão perdida — tentando reconectar...', canvas.width / 2, canvas.height - 20);
    } else if (connectionStatus === 'connecting') {
        ctx.fillStyle = '#ffcc00';
        ctx.fillText('Conectando ao servidor...', canvas.width / 2, canvas.height - 20);
    } else if (serverRestartWarningSeconds !== null) {
        ctx.fillStyle = '#ffcc00';
        ctx.fillText(`Manutenção programada do servidor em breve...`, canvas.width / 2, canvas.height - 20);
    }
}

function drawGameOver() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ff3333';
    ctx.font = '40px Arial';
    ctx.textAlign = 'center';

    const message = deathReason === 'timer'
        ? 'VOCÊ EXPLODIU POR NÃO DIVIDIR!'
        : 'VOCÊ FOI ENGOLIDO!';
    ctx.fillText(message, canvas.width / 2, canvas.height / 2);

    ctx.fillStyle = '#ffffff';
    ctx.font = '20px Arial';
    ctx.fillText('Aguarde para renascer...', canvas.width / 2, canvas.height / 2 + 50);
}

// ==========================================
// 7. LOOP PRINCIPAL (só renderiza — física é toda do servidor)
// ==========================================
function gameLoop() {
    drawGame();
    requestAnimationFrame(gameLoop);
}

gameLoop();