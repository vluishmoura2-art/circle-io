// menu.js — lógica da tela inicial do ball.io
// Suporta 3 fluxos: jogar como convidado, fazer login, ou criar conta.
// Login/registro chamam a API REST do servidor e guardam o token JWT no
// localStorage do navegador — isso é armazenamento normal de aplicação
// web (não confundir com o storage de artifacts, que é outra coisa).

const errorMessage = document.getElementById('errorMessage');

// ==========================================
// SISTEMA DE ABAS
// ==========================================
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = {
    guest: document.getElementById('guestForm'),
    login: document.getElementById('loginForm'),
    register: document.getElementById('registerForm')
};

tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        switchTab(tab);
    });
});

function switchTab(tab) {
    tabButtons.forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });
    Object.keys(tabContents).forEach((key) => {
        tabContents[key].classList.toggle('active', key === tab);
    });
    clearError();

    // Foca automaticamente no primeiro campo da aba ativa
    const firstInput = tabContents[tab].querySelector('input');
    if (firstInput) firstInput.focus();
}

function showError(message) {
    errorMessage.textContent = message;
}

function clearError() {
    errorMessage.textContent = '';
}

// Foca no campo de nome da aba inicial (convidado) ao carregar
document.getElementById('guestNameInput').focus();

// Mostra o link da loja se o jogador já tiver feito login antes (token
// salvo no localStorage de uma sessão anterior).
const shopLink = document.getElementById('shopLink');
if (localStorage.getItem('ballio_token')) {
    shopLink.style.display = 'block';
}

// ==========================================
// ABA: CONVIDADO (fluxo original, sem conta)
// ==========================================
document.getElementById('guestForm').addEventListener('submit', (event) => {
    event.preventDefault();
    clearError();

    const nameInput = document.getElementById('guestNameInput');
    const rawName = nameInput.value.trim();

    if (rawName.length === 0) {
        showError('Digite um nome pra jogar.');
        return;
    }
    if (rawName.length > 16) {
        showError('Nome muito longo (máximo 16 caracteres).');
        return;
    }

    // Convidado não tem token — index.html trata isso normalmente, o
    // jogador só não acumula Circoins nem usa skins pagas.
    goToGame(rawName, null);
});

// ==========================================
// ABA: LOGIN
// ==========================================
document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();

    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
        showError('Preencha usuário e senha.');
        return;
    }

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();

        if (!response.ok) {
            showError(data.error || 'Não foi possível entrar.');
            return;
        }

        localStorage.setItem('ballio_token', data.token);
        localStorage.setItem('ballio_username', data.user.username);
        goToGame(data.user.username, data.token);
    } catch (err) {
        showError('Erro de conexão. Tente novamente.');
    }
});

// ==========================================
// ABA: CRIAR CONTA
// ==========================================
document.getElementById('registerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();

    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value;

    if (!username || !password) {
        showError('Preencha usuário e senha.');
        return;
    }

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();

        if (!response.ok) {
            showError(data.error || 'Não foi possível criar a conta.');
            return;
        }

        localStorage.setItem('ballio_token', data.token);
        localStorage.setItem('ballio_username', data.user.username);
        goToGame(data.user.username, data.token);
    } catch (err) {
        showError('Erro de conexão. Tente novamente.');
    }
});

// ==========================================
// NAVEGAÇÃO PRO JOGO
// ==========================================
function goToGame(name, token) {
    const encodedName = encodeURIComponent(name);
    let url = `index.html?name=${encodedName}`;
    if (token) {
        // O token não vai na URL por segurança (URLs podem ficar salvas em
        // histórico/logs) — o client.js lê ele do localStorage diretamente.
        url += '&auth=1';
    }
    window.location.href = url;
}