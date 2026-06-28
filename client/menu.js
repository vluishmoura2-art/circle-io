// menu.js — lógica da tela inicial do ball.io
// Responsabilidade única: validar o nome digitado e levar o jogador pro
// index.html (o jogo de verdade), passando o nome pela URL.

const playForm = document.getElementById('playForm');
const nameInput = document.getElementById('nameInput');
const errorMessage = document.getElementById('errorMessage');

// Foca automaticamente no campo de nome ao carregar a página, pra o
// jogador já poder digitar sem precisar clicar primeiro
nameInput.focus();

playForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const rawName = nameInput.value.trim();

    // Validação no cliente (o servidor também valida/corta o nome por
    // segurança, mas aqui damos feedback imediato pro jogador)
    if (rawName.length === 0) {
        showError('Digite um nome pra jogar.');
        return;
    }

    if (rawName.length > 16) {
        showError('Nome muito longo (máximo 16 caracteres).');
        return;
    }

    // Leva o nome pro jogo via parâmetro de URL. encodeURIComponent evita
    // que caracteres especiais (espaços, acentos, &, etc.) quebrem a URL.
    const encodedName = encodeURIComponent(rawName);
    window.location.href = `index.html?name=${encodedName}`;
});

function showError(message) {
    errorMessage.textContent = message;
    nameInput.focus();
}