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

// Se o menu indicou que o jogador fez login (?auth=1), busca o token JWT
// guardado no localStorage. Sem ?auth=1, o jogador entra como convidado
// mesmo que por acaso exista um token antigo guardado — assim a aba
// "Jogar agora" do menu sempre funciona como convidado puro, sem ambiguidade.
const isAuthenticated = urlParams.get('auth') === '1';
const authToken = isAuthenticated ? localStorage.getItem('ballio_token') : null;

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
// world aqui é só um valor inicial padrão, usado por uma fração de segundo
// antes do primeiro pacote 'state' chegar — depois disso, o valor real
// enviado pelo servidor (linha ~241, serverState.world) sempre prevalece.
let serverState = {
    players: {},
    foods: [],
    viruses: [],
    leaderboard: [],
    world: { width: 6000, height: 6000 }
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
    socket.emit('join', { name: myName, token: authToken });
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
        socket.emit('respawn', { name: myName, token: authToken });
    }, 3000);
});

// v39: tratamento de desconexão — avisa visualmente, tenta reconectar sozinho
// (o próprio Socket.io já tenta reconectar por padrão; aqui só atualizamos a UI)
socket.on('disconnect', () => {
    connectionStatus = 'disconnected';
});

socket.on('reconnect', () => {
    connectionStatus = 'connected';
    socket.emit('join', { name: myName, token: authToken });
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
        const hasElectricSkin = me.ownedSkins && me.ownedSkins.includes('electric');

        for (let i = 0; i < myCells.length; i++) {
            const cell = myCells[i];
            ctx.beginPath();
            ctx.arc(cell.x, cell.y, cell.radius, 0, Math.PI * 2);
            ctx.fillStyle = '#00ffcc';
            ctx.fill();
            ctx.closePath();

            if (hasElectricSkin) {
                drawElectricEffect(cell);
                ctx.strokeStyle = '#fff700';
                ctx.lineWidth = 3;
            } else {
                ctx.strokeStyle = cell.mergeTimer > 0 ? '#33fff0' : '#007a66';
                ctx.lineWidth = 2;
            }
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

// Skin Elétrica: pequenos raios saindo da borda da célula, em posições e
// comprimentos pseudo-aleatórios baseados no tempo, pra dar um efeito de
// "crepitação" elétrica contínua sem precisar de spritesheet/imagem.
function drawElectricEffect(cell) {
    const spikeCount = 8;
    const now = Date.now();

    ctx.save();
    ctx.strokeStyle = '#fff700';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#fff700';
    ctx.shadowBlur = 8;

    for (let i = 0; i < spikeCount; i++) {
        // Cada raio "pisca" em um instante levemente diferente, criando
        // uma sensação de eletricidade instável em vez de estática.
        const seed = i * 137.5; // ângulo dourado, distribui os raios de forma irregular
        const flicker = Math.sin((now / 80) + seed) > 0.3;
        if (!flicker) continue;

        const angle = (Math.PI * 2 * i) / spikeCount + (now / 600);
        const startR = cell.radius;
        const endR = cell.radius + 6 + Math.sin(now / 50 + seed) * 4;

        const startX = cell.x + Math.cos(angle) * startR;
        const startY = cell.y + Math.sin(angle) * startR;
        const endX = cell.x + Math.cos(angle) * endR;
        const endY = cell.y + Math.sin(angle) * endR;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
    }

    ctx.restore();
}

function drawUI(me) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';

    const score = me ? Math.floor(getMassRadius(me.cells)) : 0;
    const cellCount = me ? me.cells.length : 0;
    ctx.fillText(`ball.io | Tamanho: ${score} | Pedaços: ${cellCount}`, canvas.width / 2, 40);

    if (me && !isDead) {
        const immunityCount = me.abilityCounts ? me.abilityCounts.immunity : 0;
        const deadlineSeconds = getClientSideDeadlineSeconds(score, immunityCount);
        const secondsElapsed = me.splitTimer / 30; // 30 ticks/s no servidor
        const secondsLeft = Math.max(0, Math.ceil(deadlineSeconds - secondsElapsed));

        const isUrgent = secondsLeft <= 5;
        ctx.fillStyle = isUrgent ? '#ff3333' : '#ffcc00';
        ctx.font = isUrgent ? 'bold 18px Arial' : '16px Arial';
        ctx.fillText(`Divida em: ${secondsLeft}s`, canvas.width / 2, 65);

        // Sistema de Level/XP: barra de progresso + nível atual
        drawLevelBar(me);
    }
}

function drawLevelBar(me) {
    const barWidth = 200;
    const barHeight = 10;
    const barX = canvas.width / 2 - barWidth / 2;
    const barY = 85;

    const xpProgress = me.xpNeeded > 0 ? Math.min(1, me.xp / me.xpNeeded) : 1;

    // Fundo da barra
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // Progresso
    ctx.fillStyle = '#ffcc00';
    ctx.fillRect(barX, barY, barWidth * xpProgress, barHeight);

    // Borda
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);

    // Texto do nível
    ctx.fillStyle = '#ffffff';
    ctx.font = '13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Nível ${me.level}`, canvas.width / 2, barY + barHeight + 16);
}

// Mesma tabela usada no servidor (ver server.js), só para exibição.
// O servidor é sempre quem decide a morte de fato; isso aqui é só pra
// mostrar o número certo na tela.
const SPLIT_DEADLINE_TABLE_CLIENT = [
    { minScore: 5000, seconds: 5 },
    { minScore: 1000, seconds: 10 },
    { minScore: 500, seconds: 20 },
    { minScore: 200, seconds: 30 },
    { minScore: 100, seconds: 40 },
    { minScore: 0, seconds: 50 }
];

function getClientSideDeadlineSeconds(score, immunityCount) {
    let baseSeconds = SPLIT_DEADLINE_TABLE_CLIENT[SPLIT_DEADLINE_TABLE_CLIENT.length - 1].seconds;

    for (let i = 0; i < SPLIT_DEADLINE_TABLE_CLIENT.length; i++) {
        if (score >= SPLIT_DEADLINE_TABLE_CLIENT[i].minScore) {
            baseSeconds = SPLIT_DEADLINE_TABLE_CLIENT[i].seconds;
            break;
        }
    }

    // Habilidade "Imunidade ao contador": +20% de tempo por escolha.
    const immunityMultiplier = 1 + ((immunityCount || 0) * 0.20);
    return baseSeconds * immunityMultiplier;
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
// 7. SISTEMA DE LEVEL/XP — PAINEL DE ESCOLHA DE HABILIDADE
// ==========================================
// O painel HTML (#abilityPanel, definido no index.html) fica oculto até o
// jogador ter pelo menos 1 level-up pendente. O jogo continua rodando ao
// fundo enquanto o painel está visível — não há pausa, conforme o design.
const abilityPanel = document.getElementById('abilityPanel');
const countSpeedEl = document.getElementById('countSpeed');
const countConsumptionEl = document.getElementById('countConsumption');
const countImmunityEl = document.getElementById('countImmunity');

let abilityPanelVisible = false;

function updateAbilityPanel(me) {
    if (!me || isDead) {
        hideAbilityPanel();
        return;
    }

    const hasPending = (me.pendingLevelUps || 0) > 0;

    if (hasPending && !abilityPanelVisible) {
        showAbilityPanel();
    } else if (!hasPending && abilityPanelVisible) {
        hideAbilityPanel();
    }

    if (hasPending && me.abilityCounts) {
        // Mostra quantas vezes cada habilidade já foi escolhida, pra o
        // jogador acompanhar seu build ao longo da partida.
        countSpeedEl.textContent = `${me.abilityCounts.speed}x escolhida`;
        countConsumptionEl.textContent = `${me.abilityCounts.consumption}x escolhida`;
        countImmunityEl.textContent = `${me.abilityCounts.immunity}x escolhida`;
    }
}

function showAbilityPanel() {
    abilityPanel.classList.add('visible');
    abilityPanelVisible = true;
}

function hideAbilityPanel() {
    abilityPanel.classList.remove('visible');
    abilityPanelVisible = false;
}

// Clique em qualquer um dos 3 botões envia a escolha pro servidor. O
// servidor decide se há de fato um level-up pendente antes de aplicar —
// o cliente nunca aplica o bônus por conta própria.
abilityPanel.querySelectorAll('.ability-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        const ability = btn.getAttribute('data-ability');
        socket.emit('choose_ability', { ability: ability });
    });
});

// ==========================================
// 8. LOOP PRINCIPAL (só renderiza — física é toda do servidor)
// ==========================================
function gameLoop() {
    drawGame();

    const me = myId ? serverState.players[myId] : null;
    updateAbilityPanel(me);

    requestAnimationFrame(gameLoop);
}

gameLoop();